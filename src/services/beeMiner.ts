import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import init, {
  gen_mining_keys,
  ensure_mining_keys_propagated,
  get_miner_address_by_wallet_name,
  Miner,
} from "@teamgosh/bee-sdk";

const require = createRequire(import.meta.url);

// Bee SDK endpoints are network roots. The SDK appends its own GraphQL path;
// passing our direct HTTP GraphQL URL here made its internal event client use
// `/graphql` as a server root and produced persistent pool timeouts. This
// matches the official miner-react example exactly.
const ACKI_BEE_ENDPOINTS = (
  process.env.ACKI_BEE_ENDPOINTS || "https://mainnet.ackinacki.org"
)
  .split(",")
  .map((endpoint) => endpoint.trim().replace(/\/$/, ""))
  .filter(Boolean);
const BEE_CHAIN_CRITICAL_FILE = path.join(
  process.cwd(),
  "data",
  "bee-chain-critical.json",
);
const BEE_CHAIN_CRITICAL_LEASE_MS = Math.max(
  60_000,
  Number(process.env.BEE_CHAIN_CRITICAL_LEASE_SECONDS || 600) * 1000,
);
const BEE_CHAIN_CRITICAL_OWNER = `${process.pid}:${Date.now()}`;

// Fix: @teamgosh/bee-sdk is built with `wasm-pack build --target web`, so its
// default loader uses `fetch()` against a same-origin URL — that only works
// in a real browser. We bypass it by reading the .wasm file straight off
// disk and handing the buffer to init() directly, which lets this run in a
// plain headless Node.js process (confirmed working — no browser, no
// headless Chromium needed).
let initPromise: Promise<void> | null = null;

function getWasmPath(): string {
  try {
    return path.join(
      path.dirname(require.resolve("@teamgosh/bee-sdk/package.json")),
      "bee_sdk_bg.wasm",
    );
  } catch {
    // Fallback for unusual layouts: assume standard node_modules location
    // relative to the project root.
    return path.join(process.cwd(), "node_modules", "@teamgosh", "bee-sdk", "bee_sdk_bg.wasm");
  }
}

// Second half of the same "built for browsers" problem. Loading the .wasm off
// disk (above) is only enough to *initialize*; every call that hits the network
// then failed with "Can not create http request: Can not get `window`".
//
// The check that fails is NOT `typeof window` — it is `arg0 instanceof Window`
// in the wasm-bindgen glue (__wbg_instanceof_Window_* in bee_sdk.js). That is
// why the obvious fixes do not work: `globalThis.window = globalThis` leaves
// `Window` undefined, and jsdom builds a *separate* window object while the
// glue resolves the bare global `window`. Both were tried and both still failed.
//
// So make the real global object genuinely pass `instanceof Window`. The class
// is empty, so this only splices one inert link into the prototype chain
// (globalThis -> BrowserWindow.prototype -> Object.prototype); it adds no
// properties and shadows nothing.
//
// Verified: with this in place, get_miner_address_by_wallet_name returns the
// exact same miner address that a real headless Chrome returns for the same
// wallet — cross-checked against a puppeteer run before settling on this.
function ensureBrowserGlobals(): void {
  if (typeof (globalThis as any).Window === "function") {
    return;
  }

  class BrowserWindow {}

  Object.setPrototypeOf(globalThis, BrowserWindow.prototype);
  (globalThis as any).Window = BrowserWindow;
  (globalThis as any).window = globalThis;
}

export async function ensureBeeSdkInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      ensureBrowserGlobals();
      const wasmBuffer = fs.readFileSync(getWasmPath());
      await init({ module_or_path: wasmBuffer });
    })();
  }

  return initPromise;
}

export type BeeMiningKeys = {
  deepLink: string;
  secretKey: string;
  publicKey: string;
};

// Step: generate a fresh, app-specific mining key pair for one wallet. This
// key is NOT the user's wallet private key — it's a separate key the app
// generates, which the user's real AN Wallet approves via the deep_link.
// See docs.ackinacki.com Bee Engine SDK integration guide.
export async function generateMiningKeys(appId: string): Promise<BeeMiningKeys> {
  await ensureBeeSdkInitialized();

  const result = await gen_mining_keys(appId);

  return {
    deepLink: result.deep_link,
    secretKey: result.secret,
    publicKey: result.public,
  };
}

export async function resolveMinerAddress(params: {
  appId: string;
  walletName: string;
}): Promise<string> {
  await ensureBeeSdkInitialized();

  const result = await get_miner_address_by_wallet_name({
    app_id: params.appId,
    wallet_name: params.walletName,
    client_config: {
      network: { endpoints: ACKI_BEE_ENDPOINTS },
    },
  } as any);

  // The SDK returns either a plain string or a wrapper object depending on
  // version; handle both shapes defensively.
  return typeof result === "string" ? result : (result as any)?.address ?? String(result);
}

// Step: after the user approves the deep_link in their AN Wallet, poll the
// Miner contract until the mining key shows up as confirmed. Throws if the
// user never approves within max_attempts * interval_ms.
export async function waitForMiningKeyPropagation(params: {
  appId: string;
  minerAddress: string;
  expectedOwnerPublic: string;
  maxAttempts?: number;
  intervalMs?: number;
}): Promise<void> {
  await ensureBeeSdkInitialized();

  await ensure_mining_keys_propagated({
    client_config: {
      network: { endpoints: ACKI_BEE_ENDPOINTS },
    },
    miner_address: params.minerAddress,
    app_id: params.appId,
    expected_owner_public: params.expectedOwnerPublic,
    max_attempts: params.maxAttempts ?? 30,
    interval_ms: params.intervalMs ?? 1000,
  } as any);
}

export type BeeMinerHandle = {
  miner: Miner;
  // The live event buffer of the most recent session. The callback keeps
  // pushing into it after runMiningSession() has returned, which is the only
  // way to observe how a submission actually ended — see takeLateEvents().
  lastEvents?: any[];
  // Set once the instance has been dropped from the pool after an SDK error.
  // It stays usable for anything already holding it; it is simply never handed
  // out again.
  stale?: boolean;
};

// `can_start()` is the SDK's authoritative lifecycle signal.  Keep the
// scheduler on that signal instead of inferring readiness from wall-clock
// epoch boundaries: a previous proof can still be settling after stop().
export function canStartMining(handle: BeeMinerHandle): boolean {
  try {
    return handle.miner.can_start();
  } catch {
    return false;
  }
}

// Step: construct the actual Miner instance used to run sessions, once the
// key pair has been confirmed on-chain.
export async function createMiner(params: {
  appId: string;
  minerAddress: string;
  publicKey: string;
  secretKey: string;
}): Promise<BeeMinerHandle> {
  await ensureBeeSdkInitialized();

  const miner = await Miner.new(
    ACKI_BEE_ENDPOINTS,
    params.appId,
    params.minerAddress,
    params.publicKey,
    params.secretKey,
  );

  return { miner };
}

// The reference dApp (gosh-sh/bee-engine, examples/javascript/miner-react)
// creates ONE Miner and reuses it across every start/stop cycle, calling
// free() only when deliberately re-initialising. We were building a throwaway
// Miner every 5 minutes and never freeing it — ~180 instances over a cycle.
//
// That matters because submission is two-phase: stop() emits
// `submit_session_root` and then `submit_session_proof`, and the proof can
// still be in flight well after the session function has returned. Building a
// fresh instance at the next tick is the prime suspect for cutting those
// in-flight submissions off, which is what ~28% of sessions look like: taps
// sent, no error reported, nothing on chain.
const minerPool = new Map<string, BeeMinerHandle>();
// Bee runs in its own PM2 process. Low-priority dashboard, payment and wallet
// readers therefore need a process-shared lease, not only an in-memory flag,
// to stand down while the SDK is submitting a session or reward claim.
let chainCriticalCount = 0;

function writeBeeChainCriticalLease(): void {
  const dir = path.dirname(BEE_CHAIN_CRITICAL_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${BEE_CHAIN_CRITICAL_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify({
      owner: BEE_CHAIN_CRITICAL_OWNER,
      pid: process.pid,
      enteredAt: new Date().toISOString(),
      expiresAt: Date.now() + BEE_CHAIN_CRITICAL_LEASE_MS,
    }),
    "utf-8",
  );
  fs.renameSync(temp, BEE_CHAIN_CRITICAL_FILE);
}

function removeOwnedBeeChainCriticalLease(): void {
  try {
    const current = JSON.parse(
      fs.readFileSync(BEE_CHAIN_CRITICAL_FILE, "utf-8"),
    );
    if (current?.owner === BEE_CHAIN_CRITICAL_OWNER) {
      fs.unlinkSync(BEE_CHAIN_CRITICAL_FILE);
    }
  } catch {
    // Missing, stale or partially replaced lease: there is nothing to release.
  }
}

export function enterBeeChainCritical(): void {
  chainCriticalCount += 1;
  writeBeeChainCriticalLease();
}

export function leaveBeeChainCritical(): void {
  chainCriticalCount = Math.max(0, chainCriticalCount - 1);
  if (chainCriticalCount === 0) {
    removeOwnedBeeChainCriticalLease();
  } else {
    writeBeeChainCriticalLease();
  }
}

export function isBeeChainCritical(): boolean {
  if (chainCriticalCount > 0) {
    return true;
  }

  try {
    const lease = JSON.parse(
      fs.readFileSync(BEE_CHAIN_CRITICAL_FILE, "utf-8"),
    );
    return Number(lease?.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

export function releaseBeeChainCriticalLease(): void {
  chainCriticalCount = 0;
  removeOwnedBeeChainCriticalLease();
}

function minerPoolKey(params: {
  appId: string;
  minerAddress: string;
  publicKey: string;
}): string {
  return `${params.appId}|${params.minerAddress}|${params.publicKey}`;
}

export async function acquireMiner(params: {
  appId: string;
  minerAddress: string;
  publicKey: string;
  secretKey: string;
}): Promise<BeeMinerHandle> {
  const key = minerPoolKey(params);
  const existing = minerPool.get(key);

  if (existing) {
    return existing;
  }

  const handle = await createMiner(params);
  minerPool.set(key, handle);
  return handle;
}

// Drop a miner the SDK has reported an error for, so the next acquire builds a
// clean one ("crashed — re-init to recover" in the reference UI).
//
// Deliberately does NOT call miner.free(). The reference dApp can free safely
// because nothing else holds the instance; here the same handle is still used
// by the claim later in this tick and by the deferred tap-confirmation timer
// 90s later. Freeing it under them threw "null pointer passed to rust" from
// the wasm glue and killed the process (observed 2026-08-07 ~09:00 UTC).
// Dropping the reference is enough — the wasm object is collected once nothing
// points at it.
export function discardMiner(params: {
  appId: string;
  minerAddress: string;
  publicKey: string;
}): void {
  const key = minerPoolKey(params);
  const handle = minerPool.get(key);

  if (!handle) {
    return;
  }

  handle.stale = true;
  minerPool.delete(key);
}

// Use only at a confirmed epoch boundary after both the reward claim and the
// previous session have settled. Unlike discardMiner(), this deliberately
// tears down the wasm Miner so its background GraphQL event reader cannot leak
// into the next epoch.
export function disposeMiner(params: {
  appId: string;
  minerAddress: string;
  publicKey: string;
}): void {
  const key = minerPoolKey(params);
  const handle = minerPool.get(key);

  if (!handle) {
    return;
  }

  handle.stale = true;
  minerPool.delete(key);
  try {
    handle.miner.free();
  } catch (error) {
    console.warn("Bee Miner disposal failed:", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export type MinerEventSummary = {
  count: number;
  actions: string[];
  errors: string[];
  sawSubmitRoot: boolean;
  sawSubmitProof: boolean;
  sawSessionAccepted: boolean;
  // Added 2026-08-10 while root-causing the ~18% session loss. The wasm binary
  // shows the SDK emits `session_rejected` alongside a `SessionRejectedData`
  // payload, and statuses `queued|computing|submitting|finished` — none of
  // which this summary surfaced, so a rejected session was indistinguishable
  // from one that merely went quiet.
  sawSessionRejected: boolean;
  statuses: string[];
  // Verbatim events, kept only when something went wrong, so the log gets the
  // SDK's own words instead of our lossy reading of them.
  rawOnError: string[];
};

// Events arrive as JSON strings shaped { action, data: { status }, error }.
// We were collecting them and never reading them, so an SDK-reported failure
// was invisible and the session still returned `error: null`.
export function summarizeMinerEvents(events: any[]): MinerEventSummary {
  const actions: string[] = [];
  const errors: string[] = [];
  const statuses: string[] = [];
  const rawStrings: string[] = [];

  for (const raw of events) {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (parsed?.action) {
        actions.push(String(parsed.action));
      }

      if (parsed?.error) {
        errors.push(String(parsed.error));
      }

      // `data` was parsed and dropped until now. It is where the SDK puts the
      // status, and — on a rejection — the reason.
      if (parsed?.data?.status) {
        statuses.push(String(parsed.data.status));
      }

      rawStrings.push(
        typeof raw === "string" ? raw : JSON.stringify(raw ?? null),
      );
    } catch {
      // Non-JSON messages are not interesting but must not throw.
    }
  }

  const sawSessionRejected = actions.includes("session_rejected");

  return {
    count: events.length,
    actions,
    errors,
    statuses,
    sawSubmitRoot: actions.includes("submit_session_root"),
    sawSubmitProof: actions.includes("submit_session_proof"),
    sawSessionAccepted: actions.includes("session_accepted"),
    sawSessionRejected,
    // Bounded on purpose: this fires on roughly one session in five, and the
    // out log is already millions of lines.
    rawOnError:
      errors.length || sawSessionRejected ? rawStrings.slice(0, 8) : [],
  };
}

// Read (and detach) whatever the previous session's callback pushed after we
// stopped watching it. Because the miner instance now survives between
// sessions, this finally shows how each submission really ended.
export function takeLateEvents(handle: BeeMinerHandle, fromIndex: number): any[] {
  const buffer = handle.lastEvents;

  if (!buffer) {
    return [];
  }

  return buffer.slice(fromIndex);
}

// Workers came up in ~500ms when measured against mainnet; poll finely and
// allow generous headroom so a slow chain read delays a session instead of
// failing it.
const MINER_WORKER_POLL_MS = 250;
const MINER_WORKER_READY_TIMEOUT_MS = 15000;

export type MiningSessionResult = {
  taps: number;
  events: any[];
  error: string | null;
  // Diagnostics for the ~28% of sessions whose taps never reach the chain
  // while this function still reports `taps: 70, error: null`.
  stopError: string | null;
  eventsBeforeStop: number;
  eventsAfterStop: number;
  postStopEvents: any[];
  submitSummary: MinerEventSummary;
  submitWaitedMs: number;
  // Where the event buffer stood when we returned, so the next session can
  // read exactly what arrived afterwards via takeLateEvents().
  eventIndexAtReturn: number;
};

// stop() is synchronous and returns before the submission it triggers has
// completed — the workers finish that off-thread and report through the event
// callback. Wait for `submit_session_proof` (the second and final phase)
// rather than a fixed delay, but cap it: the session already runs 240s of a
// 300s tick, so this must not push us into the next slot. Whatever has not
// arrived by then is picked up as a late event on the following session.
const SUBMIT_GRACE_MS = Number(process.env.BEE_SUBMIT_GRACE_MS || 20000);
const SUBMIT_POLL_MS = 250;

// Step: run one mining session for a fixed duration, sending a handful of
// taps spread across the window, then let it auto-submit. This mirrors what
// the reference desktop miner does per epoch, just triggered on a schedule
// instead of by a person tapping a screen.
export async function runMiningSession(
  handle: BeeMinerHandle,
  options: {
    durationMs: number;
    tapWindowMs?: number;
    tapCount?: number;
    onBeforeSubmit?: () => void;
  },
): Promise<MiningSessionResult> {
  const { miner } = handle;
  const events: any[] = [];
  let error: string | null = null;

  // Publish the buffer on the handle before the session starts: the callback
  // keeps appending to it after we return, and the next session reads the tail
  // to see how this submission actually ended.
  handle.lastEvents = events;

  const canStart = miner.can_start();

  const emptyDiagnostics = {
    stopError: null,
    eventsBeforeStop: 0,
    eventsAfterStop: 0,
    postStopEvents: [] as any[],
    submitSummary: summarizeMinerEvents([]),
    submitWaitedMs: 0,
    eventIndexAtReturn: 0,
  };

  if (!canStart) {
    return { taps: 0, events, error: "MINER_CANNOT_START", ...emptyDiagnostics };
  }

  try {
    miner.start(options.durationMs, (event: unknown) => {
      events.push(event);
    });
  } catch (startError) {
    return {
      taps: 0,
      events,
      error: startError instanceof Error ? startError.message : String(startError),
      ...emptyDiagnostics,
    };
  }

  // start() is `void`, not a Promise: it kicks off worker setup (which reads
  // miner events off chain) and returns immediately. Tapping right away always
  // threw "No running workers to add tap to" — deterministically, on an idle
  // chain as much as a busy one. Measured: can_start() flips false and taps
  // start landing ~500ms after start(). Poll for that instead of guessing.
  let workersReady = false;

  for (let waited = 0; waited < MINER_WORKER_READY_TIMEOUT_MS; waited += MINER_WORKER_POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MINER_WORKER_POLL_MS));

    if (!miner.can_start()) {
      workersReady = true;
      break;
    }
  }

  if (!workersReady) {
    try {
      miner.stop();
    } catch {
      // stop() on a miner that never started is not interesting.
    }

    return {
      taps: 0,
      events,
      error: "MINER_WORKERS_NOT_READY",
      ...emptyDiagnostics,
    };
  }

  const tapCount = options.tapCount ?? 70;
  // CappAckiMiner's observed 135-second session sends its 70 taps over a
  // 120-second work window (~1.72s each), leaving 15 seconds before the SDK's
  // own duration timer. Spreading taps over all 135 seconds made our manual
  // stop race that timer and intermittently lose submit_session_root.
  const tapWindowMs = Math.max(
    1_000,
    Math.min(options.tapWindowMs ?? options.durationMs, options.durationMs - 1_000),
  );
  const tapIntervalMs = Math.max(500, Math.floor(tapWindowMs / Math.max(1, tapCount)));
  const tapWindowStartedAt = Date.now();
  let sent = 0;

  for (let i = 0; i < tapCount; i += 1) {
    try {
      const x = Math.floor(Math.random() * 1000);
      const y = Math.floor(Math.random() * 1000);
      miner.add_tap(x, y);
      sent += 1;
    } catch (tapError) {
      error = tapError instanceof Error ? tapError.message : String(tapError);
      break;
    }

    if (i + 1 < tapCount) {
      await new Promise((resolve) => setTimeout(resolve, tapIntervalMs));
    }
  }

  // Keep the work window deterministic even though the final tap does not need
  // another interval after it. Submission then starts around 120s, safely ahead
  // of the SDK's 135s automatic boundary.
  const tapWindowRemainingMs = tapWindowStartedAt + tapWindowMs - Date.now();
  if (!error && tapWindowRemainingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, tapWindowRemainingMs));
  }

  // Fix: stop() explicitly submits results rather than waiting the full
  // duration_ms out — keeps the scheduler's own tick timing in control
  // instead of the SDK's internal timer, matching how the rest of this
  // codebase drives timing (see the mining monitor scheduler).
  const eventsBeforeStop = events.length;
  let stopError: string | null = null;

  try {
    options.onBeforeSubmit?.();
    miner.stop();
  } catch (caught) {
    stopError = caught instanceof Error ? caught.message : String(caught);
    error = error ?? stopError;
  }

  // Hold the session open until the submission's second phase lands, so a
  // silent failure becomes observable instead of being reported as success.
  const graceStartedAt = Date.now();

  while (Date.now() - graceStartedAt < SUBMIT_GRACE_MS) {
    const seen = summarizeMinerEvents(events.slice(eventsBeforeStop));

    if (seen.sawSubmitProof || seen.errors.length) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, SUBMIT_POLL_MS));
  }

  const summary = summarizeMinerEvents(events.slice(eventsBeforeStop));

  return {
    taps: sent,
    events,
    error,
    stopError,
    eventsBeforeStop,
    eventsAfterStop: events.length - eventsBeforeStop,
    postStopEvents: events.slice(eventsBeforeStop),
    submitSummary: summary,
    submitWaitedMs: Date.now() - graceStartedAt,
    eventIndexAtReturn: events.length,
  };
}

// Diagnostic: `tap_sum` is the one field of get_miner_data() that was verified
// trustworthy against mainnet (it read exactly 5 after a 5-tap test session).
// Reading it either side of a session says whether the taps actually reached the
// chain, which is the only way to tell a broken session apart from a broken
// claim when a session earns nothing. The other three fields are returned as-is
// but epoch_start / epoch_5m_start are NOT unix timestamps and their unit is
// still undecoded — do not present them as times.
export type BeeMinerData = {
  epochStart: string;
  epoch5mStart: string;
  tapSum: number;
  tapSum5m: number;
};

export async function readMinerData(
  handle: BeeMinerHandle,
): Promise<BeeMinerData | null> {
  try {
    const raw: any = await handle.miner.get_miner_data();

    if (!raw) {
      return null;
    }

    // Values come back as bigint; console.log cannot serialize those, and
    // tap counts are far inside Number's safe range.
    return {
      epochStart: String(raw.epoch_start),
      epoch5mStart: String(raw.epoch_5m_start),
      tapSum: Number(raw.tap_sum),
      tapSum5m: Number(raw.tap_sum_5m),
    };
  } catch {
    // A diagnostic must never be able to fail a mining session.
    return null;
  }
}

// Fix: the block producer rejects get_reward with QUEUE_OVERFLOW when its
// message queue is full. That is a momentary chain condition, not a broken
// miner. Measured 2026-08-06: a missed claim is NOT banked and swept later —
// the payment after the outage was a normal single-epoch amount, so giving up
// after one attempt simply forfeits that epoch's reward. Retry with backoff.
export function isTransientChainError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /QUEUE_OVERFLOW|message queue is full|pool timed out|timed out while waiting|TimeoutError|connection|ECONNRESET|EAI_AGAIN|502|503|504/i.test(
    message,
  );
}

const COLLECT_REWARD_ATTEMPTS = 4;
// A queue-full response means the selected producer is congested. Three-second
// retries only hit the same congestion wave repeatedly; an exponential 7/14/28
// second cadence gives the producer time to drain while still completing well
// before the next epoch's late-session slot.
const COLLECT_REWARD_BASE_DELAY_MS = 7000;

export async function collectReward(handle: BeeMinerHandle): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= COLLECT_REWARD_ATTEMPTS; attempt += 1) {
    try {
      await handle.miner.get_reward();
      return;
    } catch (error) {
      lastError = error;

      if (!isTransientChainError(error) || attempt === COLLECT_REWARD_ATTEMPTS) {
        throw error;
      }

      const delayMs = COLLECT_REWARD_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn("Bee collectReward retrying after transient chain error:", {
        attempt,
        nextDelayMs: delayMs,
        message: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
