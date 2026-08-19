import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { makeQrGifBuffer } from "./services/qr.js";
import fs from "node:fs";
import path from "node:path";
import {
  getAckiPopitDebug,
  getAckiPopitGameActivity,
  getAckiWalletActivity,
  getIncomingNacklTransfers,
  getIncomingShellTransfers,
  getShellBalance,
} from "./services/ackiProvider";
import {
  buildInvoiceAmountRaw,
  buildNacklInvoiceAmountRaw,
  formatNacklAmount,
  getPlanById,
  getPlanStars,
  getPlanStarsPriceUsd,
  PLANS,
  SHELL_DECIMALS,
  TEST_PLAN,
  TRIAL_DAYS,
  type Plan,
} from "./services/payments";
import {
  buildInvoiceCode,
  extractInvoiceCode,
  fetchIncomingPayments,
  fetchTonUsdRate,
  formatPayAmount,
  formatTonAmount,
  formatUsdtAmount,
  usdToTonRaw,
  usdtAmountToRaw,
} from "./services/tonPayments";
import {
  getChainEpochClock,
  setChainEpochClock,
  type ChainEpochClock,
} from "./services/epochClock";
import {
  collectReward as beeCollectReward,
  canStartMining as beeCanStartMining,
  createMiner as beeCreateMiner,
  acquireMiner as beeAcquireMiner,
  discardMiner as beeDiscardMiner,
  disposeMiner as beeDisposeMiner,
  enterBeeChainCritical as beeEnterChainCritical,
  generateMiningKeys as beeGenerateMiningKeys,
  isBeeChainCritical as beeIsChainCritical,
  leaveBeeChainCritical as beeLeaveChainCritical,
  releaseBeeChainCriticalLease as beeReleaseChainCriticalLease,
  readMinerData as beeReadMinerData,
  resolveMinerAddress as beeResolveMinerAddress,
  summarizeMinerEvents as beeSummarizeMinerEvents,
  takeLateEvents as beeTakeLateEvents,
  runMiningSession as beeRunMiningSession,
  type BeeMinerHandle,
  waitForMiningKeyPropagation as beeWaitForMiningKeyPropagation,
} from "./services/beeMiner";

type UserRecord = {
  telegramId: number;
  firstName: string;
  username?: string | undefined;
  referralCode: string;
  referredBy?: string | undefined;
  points: number;
  createdAt: string;
  lastClaimDate?: string | undefined;
  miningStartedAt?: string | undefined;
  completedTasks?: string[] | undefined;
};

const dataDir = path.join(process.cwd(), "data");
const usersFile = path.join(dataDir, "users.json");
const miningMonitorFile = path.join(dataDir, "mining-monitor.json");
const beeMinerFile = path.join(dataDir, "bee-miners.json");
const paymentsFile = path.join(dataDir, "payments.json");
const blockedChatsFile = path.join(dataDir, "blocked-chats.json");

// Telegram answers 403 "bot was blocked by the user" forever once someone
// blocks the bot. Every scheduled push kept retrying those chats on every
// tick, which produced ~35k identical errors in six weeks and burned an API
// call each time. Remember who blocked us and stop pushing to them; /start
// clears the flag, which is the only way back anyway.
let blockedChatsCache: Set<number> | null = null;

function readBlockedChats(): Set<number> {
  if (blockedChatsCache) return blockedChatsCache;

  try {
    const raw = fs.readFileSync(blockedChatsFile, "utf-8");
    const parsed = JSON.parse(raw);
    blockedChatsCache = new Set(
      Array.isArray(parsed) ? parsed.map((id: any) => Number(id)).filter(Number.isFinite) : [],
    );
  } catch {
    blockedChatsCache = new Set();
  }

  return blockedChatsCache;
}

function writeBlockedChats(set: Set<number>) {
  ensureStorage();
  fs.writeFileSync(blockedChatsFile, JSON.stringify([...set], null, 2), "utf-8");
}

export function isChatBlocked(chatId: number): boolean {
  return readBlockedChats().has(Number(chatId));
}

// Only a 403 counts. A 502/timeout is transient and must NOT retire a chat.
function isBlockedByUserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /403/.test(message) && /blocked by the user|user is deactivated/i.test(message);
}

function markChatBlocked(chatId: number) {
  const set = readBlockedChats();
  if (set.has(Number(chatId))) return;
  set.add(Number(chatId));
  writeBlockedChats(set);
  console.log("Chat marked as blocked, push notifications stopped:", { chatId });
}

function unmarkChatBlocked(chatId: number) {
  const set = readBlockedChats();
  if (!set.delete(Number(chatId))) return;
  writeBlockedChats(set);
  console.log("Chat unblocked, push notifications resumed:", { chatId });
}

// Wraps the catch side of every scheduled push: records a hard block once,
// leaves transient failures alone.
function noteNotificationFailure(chatId: number, error: unknown) {
  if (isBlockedByUserError(error)) {
    markChatBlocked(chatId);
  }
}

const MINING_MONITOR_INTERVAL_MS =
  Number(process.env.MINING_MONITOR_INTERVAL_SECONDS || 60) * 1000;
const MINING_MONITOR_INITIAL_DELAY_MS = 15 * 1000;
const MINING_MONITOR_CONCURRENCY_RAW = Number(
  // Revize fix: raised default from 4 -> 8. With 50+ watched wallets and each
  // wallet scan making several sequential provider calls, concurrency 4 was
  // the main throughput bottleneck: a full tick could take minutes, which fed
  // the scheduler drift bug above. Still overridable via env.
  process.env.MINING_MONITOR_CONCURRENCY || 8,
);
const MINING_MONITOR_CONCURRENCY = Number.isFinite(
  MINING_MONITOR_CONCURRENCY_RAW,
)
  ? Math.max(1, Math.min(12, Math.floor(MINING_MONITOR_CONCURRENCY_RAW)))
  : 4;
const MINING_MONITOR_WALLET_TIMEOUT_MS_RAW = Number(
  // Revize fix: lowered default from 45000 -> 20000. A 45s per-wallet ceiling
  // let a single slow/stuck provider call eat most of a 60s tick interval on
  // its own, which is what triggered the compounding scheduler drift. A
  // failed/slow wallet now times out faster, gets its normal error-cooldown
  // backoff, and stops blocking the rest of the tick.
  process.env.MINING_MONITOR_WALLET_TIMEOUT_MS || 20000,
);
const MINING_MONITOR_WALLET_TIMEOUT_MS = Number.isFinite(
  MINING_MONITOR_WALLET_TIMEOUT_MS_RAW,
)
  ? Math.max(5000, Math.floor(MINING_MONITOR_WALLET_TIMEOUT_MS_RAW))
  : 20000;
const MINING_MONITOR_MAX_WALLETS_PER_TICK_RAW = Number(
  process.env.MINING_MONITOR_MAX_WALLETS_PER_TICK || 16,
);
const MINING_MONITOR_MAX_WALLETS_PER_TICK = Number.isFinite(
  MINING_MONITOR_MAX_WALLETS_PER_TICK_RAW,
)
  ? Math.max(1, Math.min(100, Math.floor(MINING_MONITOR_MAX_WALLETS_PER_TICK_RAW)))
  : 16;
const MINING_MONITOR_REQUEST_DELAY_MS_RAW = Number(
  // Revize fix: lowered default from 750ms -> 300ms per scanned group. This
  // delay is paid on every group regardless of concurrency lane, so at 50+
  // wallets it was adding real seconds to every tick on its own. Still capped
  // well under the rate-limit backoff threshold.
  process.env.MINING_MONITOR_REQUEST_DELAY_MS || 300,
);
const MINING_MONITOR_REQUEST_DELAY_MS = Number.isFinite(
  MINING_MONITOR_REQUEST_DELAY_MS_RAW,
)
  ? Math.max(0, Math.min(5000, Math.floor(MINING_MONITOR_REQUEST_DELAY_MS_RAW)))
  : 300;
const MINING_MONITOR_RATE_LIMIT_BACKOFF_MS_RAW = Number(
  process.env.MINING_MONITOR_RATE_LIMIT_BACKOFF_SECONDS || 90,
);
const MINING_MONITOR_RATE_LIMIT_BACKOFF_MS = Number.isFinite(
  MINING_MONITOR_RATE_LIMIT_BACKOFF_MS_RAW,
)
  ? Math.max(30, Math.floor(MINING_MONITOR_RATE_LIMIT_BACKOFF_MS_RAW)) * 1000
  : 90 * 1000;
const MINING_MONITOR_ERROR_COOLDOWN_MS_RAW = Number(
  process.env.MINING_MONITOR_ERROR_COOLDOWN_SECONDS || 180,
);
const MINING_MONITOR_ERROR_COOLDOWN_MS = Number.isFinite(
  MINING_MONITOR_ERROR_COOLDOWN_MS_RAW,
)
  ? Math.max(30, Math.floor(MINING_MONITOR_ERROR_COOLDOWN_MS_RAW)) * 1000
  : 180 * 1000;
const MINING_MONITOR_PASSIVE_RECHECK_MS_RAW = Number(
  process.env.MINING_MONITOR_PASSIVE_RECHECK_MINUTES || 15,
);
const MINING_MONITOR_PASSIVE_RECHECK_MS = Number.isFinite(
  MINING_MONITOR_PASSIVE_RECHECK_MS_RAW,
)
  ? Math.max(5, Math.floor(MINING_MONITOR_PASSIVE_RECHECK_MS_RAW)) * 60 * 1000
  : 15 * 60 * 1000;
const MINING_MONITOR_FAST_LANE_WINDOW_MS_RAW = Number(
  process.env.MINING_MONITOR_FAST_LANE_WINDOW_MINUTES || 45,
);
const MINING_MONITOR_FAST_LANE_WINDOW_MS = Number.isFinite(
  MINING_MONITOR_FAST_LANE_WINDOW_MS_RAW,
)
  ? Math.max(10, Math.floor(MINING_MONITOR_FAST_LANE_WINDOW_MS_RAW)) * 60 * 1000
  : 45 * 60 * 1000;
const MINING_MONITOR_FAST_LANE_MAX_WALLETS_RAW = Number(
  process.env.MINING_MONITOR_FAST_LANE_MAX_WALLETS_PER_TICK || 10,
);
const MINING_MONITOR_FAST_LANE_MAX_WALLETS = Number.isFinite(
  MINING_MONITOR_FAST_LANE_MAX_WALLETS_RAW,
)
  ? Math.max(1, Math.min(
      MINING_MONITOR_MAX_WALLETS_PER_TICK,
      Math.floor(MINING_MONITOR_FAST_LANE_MAX_WALLETS_RAW),
    ))
  : Math.min(10, MINING_MONITOR_MAX_WALLETS_PER_TICK);
const MINING_MONITOR_FRESH_DELTA_WINDOW_MS_RAW = Number(
  process.env.MINING_MONITOR_FRESH_DELTA_WINDOW_MINUTES || 8,
);
const MINING_MONITOR_FRESH_DELTA_WINDOW_MS = Number.isFinite(
  MINING_MONITOR_FRESH_DELTA_WINDOW_MS_RAW,
)
  ? Math.max(3, Math.floor(MINING_MONITOR_FRESH_DELTA_WINDOW_MS_RAW)) * 60 * 1000
  : 8 * 60 * 1000;
const MINING_MONITOR_MAX_WALLETS_PER_CHAT = 15;
const MINING_MONITOR_ENABLED =
  String(process.env.MINING_MONITOR_ENABLED || "true").toLowerCase() !==
  "false";
// Scanning and notifying are separate switches on purpose.  The wallet scan
// also feeds the public site's radar stats (server.ts getRadarMiningStats reads
// data/mining-monitor.json), so turning notifications off must not stop the
// scan or the homepage numbers freeze.
const MINING_MONITOR_NOTIFY_ENABLED =
  String(process.env.MINING_MONITOR_NOTIFY_ENABLED || "true").toLowerCase() !==
  "false";
const MINING_MONITOR_SOURCE_LABEL = "PopitGame locked NACKL";
const MINING_SUMMARY_ENABLED =
  String(process.env.MINING_SUMMARY_ENABLED || "true").toLowerCase() !==
  "false";
const MINING_SUMMARY_INTERVAL_MINUTES_RAW = Number(
  process.env.MINING_SUMMARY_INTERVAL_MINUTES || 60,
);
const MINING_SUMMARY_INTERVAL_MINUTES = Number.isFinite(
  MINING_SUMMARY_INTERVAL_MINUTES_RAW,
)
  ? Math.max(1, MINING_SUMMARY_INTERVAL_MINUTES_RAW)
  : 60;
const MINING_SUMMARY_INTERVAL_MS = MINING_SUMMARY_INTERVAL_MINUTES * 60 * 1000;
const NACKL_DECIMALS = 9;
const NACKL_CUSTOM_EMOJI_ID = String(
  process.env.NACKL_CUSTOM_EMOJI_ID || "",
).trim();
const USDC_CUSTOM_EMOJI_ID = String(
  process.env.USDC_CUSTOM_EMOJI_ID || "",
).trim();
const BOT_ADMIN_IDS = new Set(
  String(process.env.BOT_ADMIN_IDS || process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

// Admins bypass the subscription gate and the one-wallet-per-plan rule, which
// makes it impossible for the operator to see what a paying user actually
// experiences. /testmode suspends those privileges for their own chat.
//
// Deliberately in memory only: a restart restores admin rights, so a mistake
// here can never lock anyone out of the admin commands.
const adminTestMode = new Set<number>();

// Read/write access for the admin panel's on/off toggle (mirrors /testmode).
export function isAdminTestModeOn(chatId: number): boolean {
  return adminTestMode.has(chatId);
}

export function setAdminTestMode(chatId: number, on: boolean): void {
  if (on) {
    adminTestMode.add(chatId);
  } else {
    adminTestMode.delete(chatId);
  }
  console.log("Admin test mode:", { chatId, testMode: on });
}

// Set once startBot() has created the Telegraf instance, so the admin
// panel (a completely separate HTTP surface) can push a message to any
// chat without needing its own bot connection.
let botInstance: import("telegraf").Telegraf<any> | null = null;

export async function sendAdminNotification(
  chatId: number,
  message: string,
): Promise<void> {
  if (!botInstance) {
    throw new Error("Bot not started yet");
  }
  await botInstance.telegram.sendMessage(chatId, message);
}

// Ignores the toggle. Used by /testmode itself and by the 1-star test plan, so
// turning privileges off cannot strand the operator without a way back.
function isRealAdminChatId(chatId: number): boolean {
  return BOT_ADMIN_IDS.has(String(chatId));
}

function isAdminChatId(chatId: number): boolean {
  if (adminTestMode.has(chatId)) {
    return false;
  }

  return BOT_ADMIN_IDS.has(String(chatId));
}

type MiningEvent = {
  at: string;
  deltaRaw: string;
  totalRaw: string;
  sourceKey?: string | null;
};

// One rolled-up UTC day. Raw events are only kept for the last couple of
// days; everything older collapses into one of these, which is what makes the
// weekly/monthly figures both correct AND cheap. See foldMiningEvents.
type MiningDailyTotal = {
  day: string; // "YYYY-MM-DD" (UTC) — lexicographic order == chronological
  deltaRaw: string;
};

type MiningWatchRecord = {
  id: string;
  chatId: number;
  input: string;
  label: string;
  address: string;
  popitGameAddress: string | null;
  lastLockedRaw: string;
  lastTransactionLt?: string | null | undefined;
  lastMonitorSourceKey?: string | null | undefined;
  lastActivityAt: number | null;
  createdAt: string;
  lastCheckedAt: string;
  lastNotifyAt?: string | undefined;
  notificationsEnabled?: boolean | undefined;
  lastSourceStatus?: "ok" | "unavailable" | undefined;
  lastSourceError?: string | undefined;
  nextScanAfter?: string | null | undefined;
  sourceFailCount?: number | undefined;
  lastRateLimitAt?: string | null | undefined;
  events: MiningEvent[];
  dailyTotals?: MiningDailyTotal[] | undefined;
};

type MiningMonitorState = {
  watches: MiningWatchRecord[];
  nextScanCursor?: number | undefined;
  nextActiveScanCursor?: number | undefined;
  nextPassiveScanCursor?: number | undefined;
  globalBackoffUntil?: string | null | undefined;
  lastRateLimitAt?: string | null | undefined;
};

type MiningMonitorRuntime = {
  startedAt: string | null;
  lastTickStartedAt: string | null;
  lastTickFinishedAt: string | null;
  lastTickTrigger: string | null;
  nextTickAt: string | null;
  lastTickWatchCount: number;
  lastTickChangedCount: number;
  lastTickNotifiedCount: number;
  lastTickErrorCount: number;
  lastError: string | null;
  isTickRunning: boolean;
};

const miningMonitorRuntime: MiningMonitorRuntime = {
  startedAt: null,
  lastTickStartedAt: null,
  lastTickFinishedAt: null,
  lastTickTrigger: null,
  nextTickAt: null,
  lastTickWatchCount: 0,
  lastTickChangedCount: 0,
  lastTickNotifiedCount: 0,
  lastTickErrorCount: 0,
  lastError: null,
  isTickRunning: false,
};

let miningMonitorTimer: ReturnType<typeof setTimeout> | undefined;
let miningSummaryTimer: ReturnType<typeof setTimeout> | undefined;

const TASKS = [
  {
    id: "join_telegram",
    title: "Telegram kanalına katıl",
    reward: 100,
  },
  {
    id: "follow_x",
    title: "X hesabını takip et",
    reward: 75,
  },
  {
    id: "invite_friend",
    title: "Arkadaş davet et",
    reward: 150,
  },
  {
    id: "open_dashboard",
    title: "Dashboard kontrolü",
    reward: 50,
  },
];

function ensureStorage() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, JSON.stringify([], null, 2), "utf-8");
  }

  if (!fs.existsSync(miningMonitorFile)) {
    fs.writeFileSync(
      miningMonitorFile,
      JSON.stringify({ watches: [] }, null, 2),
      "utf-8",
    );
  }

  if (!fs.existsSync(beeMinerFile)) {
    fs.writeFileSync(beeMinerFile, JSON.stringify({ miners: [] }, null, 2), "utf-8");
  }

  if (!fs.existsSync(paymentsFile)) {
    fs.writeFileSync(
      paymentsFile,
      JSON.stringify(
        { lastCheckedBalanceRaw: null, pendingInvoices: [], subscriptions: {}, seenMessageIds: [] },
        null,
        2,
      ),
      "utf-8",
    );
  }
}

function readUsers(): UserRecord[] {
  ensureStorage();

  const raw = fs.readFileSync(usersFile, "utf-8");

  if (!raw.trim()) {
    return [];
  }

  return JSON.parse(raw) as UserRecord[];
}

function writeUsers(users: UserRecord[]) {
  ensureStorage();
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), "utf-8");
}

// Fix: cloud/automated Bee Engine mining feature. secretKey here is the
// APP-GENERATED mining key (see beeMiner.ts) — never the user's actual AN
// Wallet private key, so this file never holds anything that could move the
// user's funds. Still sensitive (whoever holds it can mine on the wallet's
// behalf), so the VPS itself needs to be kept secure same as mining-monitor.json.
type BeeMinerRecord = {
  id: string;
  chatId: number;
  walletName: string;
  appId: string;
  publicKey: string;
  secretKey: string;
  minerAddress: string | null;
  status: "pending_authorization" | "active" | "error" | "stopped";
  lastError: string | null;
  lastSessionStartedAt: string | null;
  lastSessionAt: string | null;
  lastTapsSent: number | null;
  lastRewardAt: string | null;
  // On-chain cumulative tap count for the current cycle, cached from the tick
  // so the dashboard can show cycle progress without its own chain call.
  lastTapSum?: number | null;
  lastTapSumAt?: string | null;
  // The raw on-chain five-minute epoch identifier.  It is an opaque chain
  // value (not a timestamp) and lets the reset watcher claim exactly once.
  lastEpoch5mStart?: string | null;
  // Canonical epoch of the single logical session we have already opened.
  // Persisted so a process restart cannot create a duplicate session.
  lastSessionEpoch5mStart?: string | null;
  lastSessionEpochStatus?: "pending" | "accepted" | "tap_sum" | "failed" | null;
  // Updated only when the canonical five-minute chain value changes.
  lastEpoch5mChangedAt?: string | null;
  lastClaimedEpoch5mStart?: string | null;
  // Submission time is not a confirmed reward. The web-side chain observer
  // updates lastRewardAt only after the locked NACKL balance really increases.
  lastClaimSubmittedAt?: string | null;
  // Wall-clock 5 minute claim slot. Unlike the chain epoch field above this
  // is a real timestamp bucket, so a slow GraphQL epoch observation cannot
  // silently turn a 5-minute reward cadence into a 10-minute one.
  lastClaimedRewardSlot?: number | null;
  createdAt: string;
};

type BeeMinerState = {
  miners: BeeMinerRecord[];
};

function readBeeMinerState(): BeeMinerState {
  ensureStorage();

  const raw = fs.readFileSync(beeMinerFile, "utf-8");

  if (!raw.trim()) {
    return { miners: [] };
  }

  const parsed = JSON.parse(raw);

  return {
    miners: Array.isArray(parsed?.miners) ? parsed.miners : [],
  };
}

function writeBeeMinerState(state: BeeMinerState) {
  ensureStorage();
  fs.writeFileSync(beeMinerFile, JSON.stringify(state, null, 2), "utf-8");
}

// Fix: cloud mining subscription payments. Users pay in SHELL (Acki Nacki's
// fixed-price native token) to a dedicated payments wallet
// ("ackinackiradarpayments"), never to anyone's personal wallet. We identify
// which invoice was paid by exact amount (each invoice gets a unique small
// fractional offset) since we only have reliable visibility into the
// wallet's cumulative balance, not a per-transfer memo/comment field.
type PendingInvoice = {
  id: string;
  chatId: number;
  planId: PlanId2;
  amountRaw: string;
  createdAt: string;
  expiresAt: string;
  // TON-rail invoices carry a code the payer puts in the transfer comment.
  // Absent on legacy SHELL invoices, which are matched by exact amount.
  code?: string;
  currency?: "shell" | "usdt" | "nackl";
  // One invoice, either currency: `amountRaw` is the USDT price and
  // `amountTonRaw` the TON equivalent locked at creation time. TON is absent
  // when the rate lookup failed, in which case only USDT is accepted.
  amountTonRaw?: string;
  tonUsdRate?: number;
};

type Subscription = {
  planId: PlanId2;
  activeUntil: string;
  // Set on a trial so a second one can never be granted, even after it lapses
  // and the record is later overwritten by a paid plan.
  trial?: boolean;
};

type PaymentHistoryEntry = {
  id: string;
  status: "confirmed" | "manual_grant" | "invoice_deleted";
  source: "nackl" | "ton" | "usdt" | "shell" | "stars" | "admin";
  chatId: number;
  planId: string;
  invoiceId?: string | null;
  amountRaw?: string | null;
  currency?: string | null;
  transactionId?: string | null;
  senderAddress?: string | null;
  invoiceCreatedAt?: string | null;
  recordedAt: string;
  activeUntil?: string | null;
  adminTelegramId?: number | null;
  note?: string | null;
};

type PaymentsState = {
  lastCheckedBalanceRaw: string | null;
  pendingInvoices: PendingInvoice[];
  subscriptions: Record<string, Subscription>;
  seenMessageIds: string[];
  // NACKL transfer ids are independent of the legacy SHELL cursor. The
  // baseline flag prevents transfers predating deployment from being sold as
  // new subscriptions on the first successful chain read.
  seenNacklMessageIds?: string[];
  nacklBaselineReady?: boolean;
  // Last account transaction LT observed after a successful NACKL message scan.
  // Keep it as a string: chain logical times may exceed JS safe integer range.
  nacklLastTransactionLt?: string | null;
  // A changed account LT is scanned repeatedly for a short settle window
  // before becoming the stable cursor. The message index can lag account.info.
  nacklPendingTransactionLt?: string | null;
  nacklPendingTransactionSince?: number | null;
  // chatIds that have ever taken the free trial. Kept separately from
  // `subscriptions` because that record gets overwritten by a later purchase,
  // which would otherwise hand the same person a second trial.
  trialUsed?: number[];
  // Telegram payment charge ids already credited, so a replayed
  // successful_payment update cannot extend a subscription twice.
  starsCharges?: string[];
  // Highest TON logical time already processed. `lt` is monotonic per account,
  // so it is a reliable cursor: everything at or below it has been handled.
  tonLastLt?: number;
  // Durable audit trail shown in the admin panel. This records the party and
  // real chain transaction at credit time instead of trying to reconstruct it
  // later from a disappearing pending invoice.
  paymentHistory?: PaymentHistoryEntry[];

  // REFERRAL QUALIFICATION STEP3
  referralProfiles?: Record<
    string,
    {
      code: string;
      createdAt: string;
    }
  >;

  referrals?: Record<
    string,
    {
      referredChatId: number;
      referrerChatId: number;
      code: string;
      boundAt: string;
      qualifiedAt?: string | null;
      qualifiedPlanId?: string | null;
      paymentSource?: string | null;
    }
  >;

  referralRewards?: Array<{
    id?: string;
    referrerChatId: number;
    threshold: number;
    daysAdded: number;
    totalRewardDays: number;
    triggeredByChatId?: number;
    at: string;
  }>;
};

// Local alias so this file doesn't need a type-only import cycle concern —
// mirrors PlanId from services/payments.ts.
type PlanId2 = "standard" | "max" | "super" | "test";

function readPaymentsState(): PaymentsState {
  ensureStorage();

  const raw = fs.readFileSync(paymentsFile, "utf-8");

  if (!raw.trim()) {
    return {
      lastCheckedBalanceRaw: null,
      pendingInvoices: [],
      subscriptions: {},
      seenMessageIds: [],
    };
  }

  const parsed = JSON.parse(raw);

  return {
    // Preserve referral metadata and any future state fields owned by the
    // dashboard/API when the payment bot writes payments.json.
    ...parsed,
    lastCheckedBalanceRaw: parsed?.lastCheckedBalanceRaw ?? null,
    pendingInvoices: Array.isArray(parsed?.pendingInvoices) ? parsed.pendingInvoices : [],
    subscriptions: parsed?.subscriptions && typeof parsed.subscriptions === "object"
      ? parsed.subscriptions
      : {},
    seenMessageIds: Array.isArray(parsed?.seenMessageIds) ? parsed.seenMessageIds : [],
    seenNacklMessageIds: Array.isArray(parsed?.seenNacklMessageIds)
      ? parsed.seenNacklMessageIds
      : [],
    nacklBaselineReady: parsed?.nacklBaselineReady === true,
    nacklLastTransactionLt:
      parsed?.nacklLastTransactionLt == null
        ? null
        : String(parsed.nacklLastTransactionLt),
    nacklPendingTransactionLt:
      parsed?.nacklPendingTransactionLt == null
        ? null
        : String(parsed.nacklPendingTransactionLt),
    nacklPendingTransactionSince:
      Number.isFinite(Number(parsed?.nacklPendingTransactionSince))
        ? Number(parsed.nacklPendingTransactionSince)
        : null,
    tonLastLt: Number.isFinite(Number(parsed?.tonLastLt))
      ? Number(parsed.tonLastLt)
      : 0,
    trialUsed: Array.isArray(parsed?.trialUsed) ? parsed.trialUsed : [],
    starsCharges: Array.isArray(parsed?.starsCharges) ? parsed.starsCharges : [],
    paymentHistory: Array.isArray(parsed?.paymentHistory)
      ? parsed.paymentHistory
      : [],
  };
}

function appendPaymentHistory(
  state: PaymentsState,
  entry: PaymentHistoryEntry,
): void {
  const history = Array.isArray(state.paymentHistory) ? state.paymentHistory : [];
  if (history.some((item) => item.id === entry.id)) return;
  state.paymentHistory = [...history, entry].slice(-500);
}

// Plans that a Stars invoice may have been issued for. Wider than
// getPlanById because the admin-only test plan is kept out of PLANS: once an
// invoice exists, both the pre-checkout answer and the crediting step have to
// recognise it, or the payment is taken and never honoured.
function resolvePaidPlan(planId: string): Plan | undefined {
  return planId === TEST_PLAN.id ? TEST_PLAN : getPlanById(planId);
}

// Shared by every rail (Stars, TON, trial): extend from the later of now and
// any remaining time, so buying early adds days instead of discarding them.
function grantSubscription(
  state: PaymentsState,
  chatId: number,
  planId: PlanId2,
  days: number,
  options: {
    trial?: boolean;
    paid?: boolean;
    paymentSource?: string;
  } = {},
): string {
  const now = Date.now();
  const existing = state.subscriptions[String(chatId)];
  const base =
    existing && new Date(existing.activeUntil).getTime() > now
      ? new Date(existing.activeUntil).getTime()
      : now;
  const activeUntil = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();

  state.subscriptions[String(chatId)] = {
    planId,
    activeUntil,
    ...(options.trial ? { trial: true } : {}),
  };

  // Trial and the admin-only 1-star test plan never qualify a referral.
  if (
    options.paid &&
    planId !== "test"
  ) {
    qualifyReferralForPaidSubscription(
      state,
      chatId,
      planId,
      options.paymentSource || "paid",
    );
  }

  return activeUntil;
}


const REFERRAL_REWARD_MILESTONES = [
  {
    count: 1,
    addDays: 15,
    totalDays: 15,
  },
  {
    count: 3,
    addDays: 15,
    totalDays: 30,
  },
  {
    count: 9,
    addDays: 60,
    totalDays: 90,
  },
] as const;


function qualifyReferralForPaidSubscription(
  state: PaymentsState,
  paidChatId: number,
  paidPlanId: PlanId2,
  paymentSource: string,
): void {
  const referrals =
    state.referrals &&
    typeof state.referrals === "object"
      ? state.referrals
      : {};

  const binding =
    referrals[String(paidChatId)];

  // No referral, already qualified, or impossible self-referral.
  if (
    !binding ||
    binding.qualifiedAt ||
    Number(binding.referrerChatId) ===
      paidChatId
  ) {
    return;
  }

  const referrerChatId =
    Number(binding.referrerChatId);

  if (
    !Number.isSafeInteger(
      referrerChatId,
    ) ||
    referrerChatId <= 0
  ) {
    console.error(
      "Referral qualification skipped: invalid referrer id",
      {
        paidChatId,
        referrerChatId,
      },
    );

    return;
  }

  const now =
    Date.now();

  const nowIso =
    new Date(now)
      .toISOString();

  // The referred account qualifies exactly once.
  binding.qualifiedAt =
    nowIso;

  binding.qualifiedPlanId =
    paidPlanId;

  binding.paymentSource =
    paymentSource;

  state.referrals =
    referrals;

  const qualifiedCount =
    Object.values(
      referrals,
    ).filter(
      (item) =>
        item &&
        Number(
          item.referrerChatId,
        ) === referrerChatId &&
        Boolean(
          item.qualifiedAt,
        ),
    ).length;

  const rewards =
    Array.isArray(
      state.referralRewards,
    )
      ? [
          ...state.referralRewards,
        ]
      : [];

  const rewardedThresholds =
    new Set(
      rewards
        .filter(
          (item) =>
            Number(
              item.referrerChatId,
            ) === referrerChatId,
        )
        .map(
          (item) =>
            Number(
              item.threshold,
            ),
        ),
    );


  for (
    const milestone
    of REFERRAL_REWARD_MILESTONES
  ) {
    if (
      qualifiedCount <
        milestone.count ||
      rewardedThresholds.has(
        milestone.count,
      )
    ) {
      continue;
    }

    const referrerKey =
      String(
        referrerChatId,
      );

    const existing =
      state.subscriptions[
        referrerKey
      ];

    const existingExpiry =
      existing
        ? new Date(
            existing.activeUntil,
          ).getTime()
        : NaN;

    const base =
      Number.isFinite(
        existingExpiry,
      ) &&
      existingExpiry > now
        ? existingExpiry
        : now;

    // Preserve a real paid tier.
    // If the account currently has TEST/no plan, referral rewards begin
    // as Standard subscription time.
    const rewardPlanId: PlanId2 =
      existing?.planId === "standard" ||
      existing?.planId === "max" ||
      existing?.planId === "super"
        ? existing.planId
        : "standard";

    const activeUntil =
      new Date(
        base +
          milestone.addDays *
            24 *
            60 *
            60 *
            1000,
      ).toISOString();

    state.subscriptions[
      referrerKey
    ] = {
      planId:
        rewardPlanId,

      activeUntil,
    };

    rewards.push({
      id:
        `ref:${referrerChatId}:` +
        `${milestone.count}:` +
        `${paidChatId}`,

      referrerChatId,

      threshold:
        milestone.count,

      daysAdded:
        milestone.addDays,

      totalRewardDays:
        milestone.totalDays,

      triggeredByChatId:
        paidChatId,

      at:
        nowIso,
    });

    rewardedThresholds.add(
      milestone.count,
    );

    console.log(
      "Referral reward granted:",
      {
        referrerChatId,
        paidChatId,
        qualifiedCount,
        threshold:
          milestone.count,
        daysAdded:
          milestone.addDays,
        totalRewardDays:
          milestone.totalDays,
        planId:
          rewardPlanId,
        activeUntil,
      },
    );
  }

  state.referralRewards =
    rewards.slice(-1000);

  console.log(
    "Referral qualified:",
    {
      paidChatId,
      referrerChatId,
      paidPlanId,
      paymentSource,
      qualifiedCount,
    },
  );
}


function writePaymentsState(state: PaymentsState) {
  ensureStorage();
  fs.writeFileSync(paymentsFile, JSON.stringify(state, null, 2), "utf-8");
}

function hasActiveSubscriptionForChat(
  state: PaymentsState,
  chatId: number,
  now = Date.now(),
): boolean {
  const subscription = state.subscriptions[String(chatId)];
  const activeUntil = subscription ? new Date(subscription.activeUntil).getTime() : NaN;

  return Number.isFinite(activeUntil) && activeUntil > now;
}

const PAYMENTS_WALLET_NAME =
  process.env.PAYMENTS_WALLET_NAME || "ackinackiradarpayments";
const PAYMENTS_INVOICE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes to pay
// Longer than the SHELL window: a TON payer may have to fund or top up a
// wallet first, and the invoice code makes a stale invoice harmless anyway
// (it is dropped on expiry, so it cannot be redeemed later).
const TON_INVOICE_EXPIRY_MS =
  Number(process.env.TON_INVOICE_EXPIRY_MINUTES || 120) * 60 * 1000;
const NACKL_PAYMENTS_WALLET_NAME =
  process.env.NACKL_PAYMENTS_WALLET_NAME || PAYMENTS_WALLET_NAME;
const NACKL_INVOICE_EXPIRY_MS =
  Number(process.env.NACKL_INVOICE_EXPIRY_MINUTES || 120) * 60 * 1000;

function allocateInvoiceAmountRaw(plan: Plan, state: PaymentsState): string {
  const usedAmounts = new Set(
    state.pendingInvoices
      .filter((invoice) => !invoice.currency || invoice.currency === "shell")
      .map((invoice) => String(invoice.amountRaw)),
  );
  const initialOffset = Date.now() % 999;

  for (let attempt = 0; attempt < 999; attempt += 1) {
    const amountRaw = buildInvoiceAmountRaw(
      plan.priceShellRaw,
      initialOffset + attempt,
    );

    if (!usedAmounts.has(amountRaw)) {
      return amountRaw;
    }
  }

  throw new Error("INVOICE_AMOUNT_CAPACITY_REACHED");
}

function allocateNacklInvoiceAmountRaw(plan: Plan, state: PaymentsState): string {
  const usedAmounts = new Set(
    state.pendingInvoices
      .filter((invoice) => invoice.currency === "nackl")
      .map((invoice) => String(invoice.amountRaw)),
  );
  const initialOffset = Date.now() % 999;

  for (let attempt = 0; attempt < 999; attempt += 1) {
    const amountRaw = buildNacklInvoiceAmountRaw(
      plan.priceNacklRaw,
      initialOffset + attempt,
    );

    if (!usedAmounts.has(amountRaw)) return amountRaw;
  }

  throw new Error("NACKL_INVOICE_AMOUNT_CAPACITY_REACHED");
}

function formatShellAmount(raw: string): string {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(SHELL_DECIMALS);
  const whole = value / scale;
  const fraction = value % scale;
  const fractionStr = fraction.toString().padStart(SHELL_DECIMALS, "0").slice(0, 3);
  return `${whole}.${fractionStr}`;
}

function readMiningMonitorState(): MiningMonitorState {
  ensureStorage();

  const raw = fs.readFileSync(miningMonitorFile, "utf-8");

  if (!raw.trim()) {
    return { watches: [] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<MiningMonitorState>;
    const watches = Array.isArray(parsed.watches) ? parsed.watches : [];

    return {
      nextScanCursor: Number.isFinite(Number(parsed.nextScanCursor))
        ? Number(parsed.nextScanCursor)
        : 0,
      nextActiveScanCursor: Number.isFinite(Number(parsed.nextActiveScanCursor))
        ? Number(parsed.nextActiveScanCursor)
        : 0,
      nextPassiveScanCursor: Number.isFinite(Number(parsed.nextPassiveScanCursor))
        ? Number(parsed.nextPassiveScanCursor)
        : 0,
      globalBackoffUntil: parsed.globalBackoffUntil
        ? String(parsed.globalBackoffUntil)
        : null,
      lastRateLimitAt: parsed.lastRateLimitAt
        ? String(parsed.lastRateLimitAt)
        : null,
      watches: watches
        .filter((watch: any) => watch && watch.chatId && watch.address)
        .map((watch: any) => ({
          ...watch,
          input: String(watch.input || watch.label || watch.address || ""),
          label: String(
            watch.label || watch.input || watch.address || "Wallet",
          ),
          address: String(watch.address || ""),
          popitGameAddress: watch.popitGameAddress || null,
          lastLockedRaw: String(watch.lastLockedRaw || "0"),
          lastTransactionLt: watch.lastTransactionLt
            ? String(watch.lastTransactionLt)
            : null,
          lastMonitorSourceKey: watch.lastMonitorSourceKey
            ? String(watch.lastMonitorSourceKey)
            : null,
          lastActivityAt:
            typeof watch.lastActivityAt === "number"
              ? watch.lastActivityAt
              : null,
          createdAt: watch.createdAt || new Date().toISOString(),
          lastCheckedAt: watch.lastCheckedAt || new Date().toISOString(),
          notificationsEnabled: watch.notificationsEnabled !== false,
          lastSourceStatus:
            watch.lastSourceStatus === "unavailable" ? "unavailable" : "ok",
          lastSourceError: watch.lastSourceError
            ? String(watch.lastSourceError)
            : undefined,
          events: Array.isArray(watch.events) ? watch.events : [],
          dailyTotals: Array.isArray(watch.dailyTotals) ? watch.dailyTotals : [],
        })),
    };
  } catch {
    return { watches: [] };
  }
}

function writeMiningMonitorState(state: MiningMonitorState) {
  ensureStorage();
  fs.writeFileSync(miningMonitorFile, JSON.stringify(state, null, 2), "utf-8");
}

// Fix: the monitor tick reads state ONCE at the start and used to write the
// whole thing back at the end, 20-40+ seconds later. If /watch, /unwatch, or
// any other command edited state in that window, the tick's stale in-memory
// copy would overwrite that edit when it finally wrote — most visibly,
// /unwatch appearing to do nothing because the tick "resurrected" the
// removed wallet moments later. This re-reads the CURRENT on-disk state
// right before writing and uses it as the source of truth for which watches
// exist (so deletions/additions made during the tick are respected), only
// layering the specific fields the monitor itself owns (scan results, not
// user-editable fields like label/notificationsEnabled) on top for watches
// that still exist in both copies.
const MONITOR_OWNED_WATCH_FIELDS = [
  "lastLockedRaw",
  "lastTransactionLt",
  "lastMonitorSourceKey",
  "lastActivityAt",
  "lastCheckedAt",
  "lastNotifyAt",
  "lastSourceStatus",
  "lastSourceError",
  "nextScanAfter",
  "sourceFailCount",
  "lastRateLimitAt",
  "events",
  // MUST stay next to "events": the monitor tick moves value from events into
  // dailyTotals (foldMiningEvents). If only "events" is merged back to disk,
  // the trimmed-away events are written as gone while their rolled-up totals
  // are dropped — silent, permanent data loss. Learned the hard way.
  "dailyTotals",
] as const;

function mergeAndWriteMiningMonitorState(tickState: MiningMonitorState) {
  const freshState = readMiningMonitorState();
  const tickWatchById = new Map(
    tickState.watches.map((watch) => [watch.id, watch]),
  );

  freshState.watches = freshState.watches.map((freshWatch) => {
    const tickWatch = tickWatchById.get(freshWatch.id);

    if (!tickWatch) {
      return freshWatch;
    }

    const merged: MiningWatchRecord = { ...freshWatch };
    for (const field of MONITOR_OWNED_WATCH_FIELDS) {
      (merged as any)[field] = (tickWatch as any)[field];
    }
    return merged;
  });

  freshState.nextScanCursor = tickState.nextScanCursor;
  freshState.nextActiveScanCursor = tickState.nextActiveScanCursor;
  freshState.nextPassiveScanCursor = tickState.nextPassiveScanCursor;
  freshState.globalBackoffUntil = tickState.globalBackoffUntil;
  freshState.lastRateLimitAt = tickState.lastRateLimitAt;

  writeMiningMonitorState(freshState);
}

function cloneMiningWatchForScan(watch: MiningWatchRecord): MiningWatchRecord {
  return {
    ...watch,
    events: Array.isArray(watch.events) ? [...watch.events] : [],
    dailyTotals: Array.isArray(watch.dailyTotals) ? [...watch.dailyTotals] : [],
  };
}


type MiningSourceScanGroup = {
  key: string;
  watches: MiningWatchRecord[];
  baselineWatch: MiningWatchRecord;
};

function getMiningSourceScanKey(watch: MiningWatchRecord) {
  const popit = String(watch.popitGameAddress || "").trim().toLowerCase();

  if (popit) {
    return `popit:${popit}`;
  }

  const address = String(watch.address || "").trim().toLowerCase();

  if (address) {
    return `address:${address}`;
  }

  return `watch:${watch.id}`;
}

function pickMiningSourceBaselineWatch(watches: MiningWatchRecord[]) {
  return watches.reduce((best, current) => {
    const bestRaw = safeBigInt(best.lastLockedRaw);
    const currentRaw = safeBigInt(current.lastLockedRaw);

    if (currentRaw > bestRaw) {
      return current;
    }

    if (currentRaw === bestRaw) {
      const bestCheckedAt = parseIsoTimeMs(best.lastCheckedAt);
      const currentCheckedAt = parseIsoTimeMs(current.lastCheckedAt);

      if (currentCheckedAt > bestCheckedAt) {
        return current;
      }
    }

    return best;
  }, watches[0] as MiningWatchRecord);
}

function buildMiningSourceScanGroups(
  selectedWatches: MiningWatchRecord[],
  allWatches: MiningWatchRecord[] = selectedWatches,
) {
  const selectedKeys = new Set(
    selectedWatches.map((watch) => getMiningSourceScanKey(watch)),
  );
  const groups = new Map<string, MiningWatchRecord[]>();

  for (const watch of allWatches) {
    const key = getMiningSourceScanKey(watch);

    if (!selectedKeys.has(key)) {
      continue;
    }

    const existing = groups.get(key) || [];
    existing.push(watch);
    groups.set(key, existing);
  }

  return Array.from(groups.entries()).map(([key, groupWatches]) => ({
    key,
    watches: groupWatches,
    baselineWatch: pickMiningSourceBaselineWatch(groupWatches),
  }));
}

function syncMiningSourceScanResultToWatch(
  target: MiningWatchRecord,
  source: MiningWatchRecord,
  result: {
    changed: boolean;
    deltaRaw: string;
    lockedRaw: string;
    sourceKey?: string | null;
  },
) {
  target.address = source.address;
  target.popitGameAddress = source.popitGameAddress || target.popitGameAddress || null;
  target.lastActivityAt = source.lastActivityAt || target.lastActivityAt || null;
  target.lastCheckedAt = source.lastCheckedAt;
  target.lastSourceStatus = source.lastSourceStatus;
  target.lastSourceError = source.lastSourceError;
  target.nextScanAfter = source.nextScanAfter;
  target.sourceFailCount = source.sourceFailCount;
  target.lastRateLimitAt = source.lastRateLimitAt;
  target.lastLockedRaw = source.lastLockedRaw;
  target.lastTransactionLt = source.lastTransactionLt || null;
  target.lastMonitorSourceKey = source.lastMonitorSourceKey || result.sourceKey || null;

  if (result.changed && result.sourceKey) {
    const exists = (target.events || []).some(
      (event) => event.sourceKey === result.sourceKey,
    );

    if (!exists) {
      target.events.push({
        at: source.lastCheckedAt || new Date().toISOString(),
        deltaRaw: result.deltaRaw,
        totalRaw: result.lockedRaw,
        sourceKey: result.sourceKey,
      });
      foldMiningEvents(target);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function parseIsoTimeMs(value?: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoAfter(ms: number) {
  return new Date(Date.now() + Math.max(0, ms)).toISOString();
}

function isMiningRateLimitError(message: string) {
  return /\b429\b|rate limit|too many requests/i.test(message);
}

function isMiningPoolTimeoutError(message: string) {
  return /pool timed out|timed out while waiting|MINING_MONITOR_WALLET_TIMEOUT|TimeoutError|connection/i.test(message);
}

function isMiningSourceUnavailableError(message: string) {
  return /POPIT_LOCKED_SOURCE_UNAVAILABLE|MININGHUB_REQUIRES_WALLET_NAME/i.test(message);
}

function normalizeMiningScanCursor(state: MiningMonitorState) {
  const total = state.watches.length;

  if (total <= 0) {
    state.nextScanCursor = 0;
    return 0;
  }

  const current = Number(state.nextScanCursor || 0);
  return Number.isFinite(current) ? Math.max(0, Math.floor(current)) % total : 0;
}

function normalizeMiningGroupCursor(value: unknown, total: number) {
  if (total <= 0) {
    return 0;
  }

  const current = Number(value || 0);
  return Number.isFinite(current) ? Math.max(0, Math.floor(current)) % total : 0;
}

type MiningScanSelection = {
  watches: MiningWatchRecord[];
  skippedCooldown: number;
  skippedBackoff: number;
  startCursor: number;
  nextCursor: number;
  activeEligible: number;
  passiveEligible: number;
  selectedActive: number;
  selectedPassive: number;
  selectedPriority: number;
  bypassedActiveCooldown: number;
  startActiveCursor: number;
  nextActiveCursor: number;
  startPassiveCursor: number;
  nextPassiveCursor: number;
};

function getMiningWatchLastEventMs(watch: MiningWatchRecord) {
  return (watch.events || []).reduce((latest, event) => {
    const at = parseIsoTimeMs(event.at);
    return at > latest ? at : latest;
  }, 0);
}

function getMiningWatchActivityMs(watch: MiningWatchRecord) {
  const raw = Number(watch.lastActivityAt || 0);

  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }

  // lastPaid comes from chain state as unix seconds.
  return raw > 999999999999 ? raw : raw * 1000;
}

function hasRecentMiningWatchActivity(
  watch: MiningWatchRecord,
  nowMs: number,
  windowMs = MINING_MONITOR_FAST_LANE_WINDOW_MS,
) {
  const recentSinceMs = nowMs - windowMs;
  const recentEventMs = getMiningWatchLastEventMs(watch);
  const notifyMs = parseIsoTimeMs(watch.lastNotifyAt);
  const activityMs = getMiningWatchActivityMs(watch);
  const createdMs = parseIsoTimeMs(watch.createdAt);

  return (
    recentEventMs >= recentSinceMs ||
    notifyMs >= recentSinceMs ||
    activityMs >= recentSinceMs ||
    createdMs >= recentSinceMs
  );
}

function isMiningWatchFastLaneCandidate(
  watch: MiningWatchRecord,
  nowMs: number,
) {
  // Revize 9.6.27: do not eject recently active wallets from the fast lane just
  // because the previous scan had a transient provider/pool timeout. That made
  // actively mining wallets wait behind the passive queue and miss notifications.
  return hasRecentMiningWatchActivity(watch, nowMs);
}

function pickCircularMiningWatches(
  watches: MiningWatchRecord[],
  cursorValue: unknown,
  limit: number,
) {
  const total = watches.length;
  const startCursor = normalizeMiningGroupCursor(cursorValue, total);

  if (total <= 0 || limit <= 0) {
    return {
      selected: [] as MiningWatchRecord[],
      startCursor,
      nextCursor: startCursor,
    };
  }

  const selected: MiningWatchRecord[] = [];
  let nextCursor = startCursor;

  for (let offset = 0; offset < total && selected.length < limit; offset += 1) {
    const index = (startCursor + offset) % total;
    const watch = watches[index];

    if (!watch) {
      continue;
    }

    selected.push(watch);
    nextCursor = (index + 1) % total;
  }

  return {
    selected,
    startCursor,
    nextCursor,
  };
}

function selectMiningWatchesForTick(
  state: MiningMonitorState,
  nowMs: number,
  priorityPopitAddresses: Set<string> = new Set(),
): MiningScanSelection {
  const total = state.watches.length;
  const backoffUntilMs = parseIsoTimeMs(state.globalBackoffUntil);
  const startCursor = normalizeMiningScanCursor(state);
  const startActiveCursor = normalizeMiningGroupCursor(
    state.nextActiveScanCursor,
    total,
  );
  const startPassiveCursor = normalizeMiningGroupCursor(
    state.nextPassiveScanCursor,
    total,
  );

  if (total <= 0 || backoffUntilMs > nowMs) {
    return {
      watches: [],
      skippedCooldown: 0,
      skippedBackoff: total,
      startCursor,
      nextCursor: startCursor,
      activeEligible: 0,
      passiveEligible: 0,
      selectedActive: 0,
      selectedPassive: 0,
      selectedPriority: 0,
      bypassedActiveCooldown: 0,
      startActiveCursor,
      nextActiveCursor: startActiveCursor,
      startPassiveCursor,
      nextPassiveCursor: startPassiveCursor,
    };
  }

  let skippedCooldown = 0;
  let bypassedActiveCooldown = 0;
  // Scaling fix: wallets the cheap batch pre-check confirmed as changed go
  // here — they get scanned THIS tick regardless of fast/passive rotation
  // position or cooldown, since we already know something real happened.
  // Everything else falls back to the exact same rotation as before, so if
  // the batch check fails or misses a wallet (new wallet, network hiccup),
  // behavior is no worse than before this change.
  const priorityCandidates: MiningWatchRecord[] = [];
  const activeCandidates: MiningWatchRecord[] = [];
  const passiveCandidates: MiningWatchRecord[] = [];

  for (const watch of state.watches) {
    const popitKey = String(watch.popitGameAddress || "").toLowerCase();
    const isPriority = Boolean(popitKey) && priorityPopitAddresses.has(popitKey);

    if (isPriority) {
      priorityCandidates.push(watch);
      continue;
    }

    const nextScanAfterMs = parseIsoTimeMs(watch.nextScanAfter);

    if (nextScanAfterMs > nowMs) {
      if (
        !watch.lastRateLimitAt &&
        isMiningPoolTimeoutError(String(watch.lastSourceError || "")) &&
        isMiningWatchFastLaneCandidate(watch, nowMs)
      ) {
        // Revize 9.6.27: active wallets that hit a provider pool timeout should
        // not wait for the full error cooldown. Keep them in the fast lane so
        // the next tick can catch the fresh PopitGame transaction.
        bypassedActiveCooldown += 1;
        activeCandidates.push(watch);
        continue;
      }

      skippedCooldown += 1;
      continue;
    }

    if (isMiningWatchFastLaneCandidate(watch, nowMs)) {
      activeCandidates.push(watch);
    } else {
      passiveCandidates.push(watch);
    }
  }

  const priorityUsed = priorityCandidates.slice(
    0,
    MINING_MONITOR_MAX_WALLETS_PER_TICK,
  );
  const remainingBudget = Math.max(
    0,
    MINING_MONITOR_MAX_WALLETS_PER_TICK - priorityUsed.length,
  );

  const activePick = pickCircularMiningWatches(
    activeCandidates,
    state.nextActiveScanCursor,
    Math.min(MINING_MONITOR_FAST_LANE_MAX_WALLETS, remainingBudget),
  );
  const passiveBudget = Math.max(
    0,
    remainingBudget - activePick.selected.length,
  );
  const passivePick = pickCircularMiningWatches(
    passiveCandidates,
    state.nextPassiveScanCursor,
    passiveBudget,
  );
  const selected = [
    ...priorityUsed,
    ...activePick.selected,
    ...passivePick.selected,
  ];

  // Keep the legacy cursor moving for older state readers, but use the explicit
  // active/passive cursors for the queue itself.
  const nextCursor = total > 0
    ? (startCursor + Math.max(1, selected.length)) % total
    : 0;

  return {
    watches: selected,
    skippedCooldown,
    skippedBackoff: 0,
    startCursor,
    nextCursor,
    activeEligible: activeCandidates.length,
    passiveEligible: passiveCandidates.length,
    selectedActive: activePick.selected.length,
    selectedPassive: passivePick.selected.length,
    selectedPriority: priorityUsed.length,
    bypassedActiveCooldown,
    startActiveCursor: activePick.startCursor,
    nextActiveCursor: activePick.nextCursor,
    startPassiveCursor: passivePick.startCursor,
    nextPassiveCursor: passivePick.nextCursor,
  };
}

function markMiningWatchScanSuccess(watch: MiningWatchRecord) {
  watch.nextScanAfter = null;
  watch.sourceFailCount = 0;
  watch.lastRateLimitAt = null;
}

function markMiningWatchScanError(
  watch: MiningWatchRecord,
  message: string,
  state: MiningMonitorState,
) {
  const nowIso = new Date().toISOString();
  watch.lastCheckedAt = nowIso;
  watch.lastSourceStatus = "unavailable";
  watch.lastSourceError = message;
  watch.sourceFailCount = Math.max(0, Number(watch.sourceFailCount || 0)) + 1;

  if (isMiningRateLimitError(message)) {
    const until = isoAfter(MINING_MONITOR_RATE_LIMIT_BACKOFF_MS);
    watch.lastRateLimitAt = nowIso;
    watch.nextScanAfter = until;
    state.lastRateLimitAt = nowIso;
    state.globalBackoffUntil = until;
    return;
  }

  const activeRetryMs = Math.max(
    15000,
    Math.min(60000, MINING_MONITOR_INTERVAL_MS),
  );
  const isRecentActive = hasRecentMiningWatchActivity(watch, Date.now());

  if (isMiningSourceUnavailableError(message)) {
    watch.nextScanAfter = isRecentActive
      ? isoAfter(activeRetryMs)
      : isoAfter(MINING_MONITOR_PASSIVE_RECHECK_MS);
    return;
  }

  if (isMiningPoolTimeoutError(message)) {
    watch.nextScanAfter = isRecentActive
      ? isoAfter(activeRetryMs)
      : isoAfter(MINING_MONITOR_ERROR_COOLDOWN_MS);
    return;
  }

  watch.nextScanAfter = isRecentActive
    ? isoAfter(activeRetryMs)
    : isoAfter(MINING_MONITOR_ERROR_COOLDOWN_MS);
}

function withMiningMonitorTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(`MINING_MONITOR_WALLET_TIMEOUT:${label}:${timeoutMs}ms`),
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function runMiningMonitorWorkers<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.min(
    Math.max(1, concurrency),
    Math.max(1, items.length),
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= items.length) {
          return;
        }

        await worker(items[index] as T, index);
      }
    }),
  );
}

function createMiningWatchId(chatId: number, address: string) {
  return `${chatId}:${address.toLowerCase()}`;
}

function createMiningWatchCallbackKey(watch: MiningWatchRecord) {
  let hash = 2166136261;
  const source = watch.id.toLowerCase();

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function findMiningWatchByCallbackKey(chatId: number, key: string) {
  return readMiningMonitorState().watches.find(
    (watch) =>
      watch.chatId === chatId && createMiningWatchCallbackKey(watch) === key,
  );
}

function findMiningWatchInStateByCallbackKey(
  state: MiningMonitorState,
  chatId: number,
  key: string,
) {
  return state.watches.find(
    (watch) =>
      watch.chatId === chatId && createMiningWatchCallbackKey(watch) === key,
  );
}

function normalizeMiningInput(input?: string) {
  return String(input || "")
    .trim()
    .replace(/^@/, "");
}

function getNacklRaw(tokens?: Array<{ symbol: string; balanceRaw: string }>) {
  const token = (tokens || []).find(
    (item) => item.symbol.toUpperCase() === "NACKL",
  );
  return token ? String(token.balanceRaw || "0") : "0";
}

function getLockedNacklRawForMonitor(
  wallet: Awaited<ReturnType<typeof getAckiWalletActivity>>,
) {
  if (!wallet.popitGame) {
    throw new Error("POPIT_LOCKED_SOURCE_UNAVAILABLE");
  }

  return getNacklRaw(wallet.popitGame.lockedTokens || wallet.lockedTokens);
}

function getPopitMonitorSourceKey(
  wallet: Awaited<ReturnType<typeof getAckiWalletActivity>>,
  lockedRaw?: string | null,
) {
  if (!wallet.popitGame) {
    throw new Error("POPIT_LOCKED_SOURCE_UNAVAILABLE");
  }

  const transactionLt = String(wallet.popitGame.lastTransactionLt || "").trim();
  const normalizedLockedRaw = String(lockedRaw ?? "").trim();
  const rawPart = normalizedLockedRaw ? `raw:${normalizedLockedRaw}` : null;

  if (transactionLt) {
    return rawPart ? `lt:${transactionLt}|${rawPart}` : `lt:${transactionLt}`;
  }

  const lastPaid = wallet.popitGame.lastPaid || wallet.lastPaid;

  if (
    typeof lastPaid === "number" &&
    Number.isFinite(lastPaid) &&
    lastPaid > 0
  ) {
    return rawPart ? `paid:${lastPaid}|${rawPart}` : `paid:${lastPaid}`;
  }

  return rawPart;
}

function getPopitLastTransactionLt(
  wallet: Awaited<ReturnType<typeof getAckiWalletActivity>>,
) {
  return wallet.popitGame?.lastTransactionLt
    ? String(wallet.popitGame.lastTransactionLt)
    : null;
}

function formatMonitorSourceError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error || "UNKNOWN_ERROR");

  return message.slice(0, 120);
}

function formatNumberValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return addThousandsSeparator(String(value));
}

function safeBigInt(value?: string | null) {
  const raw = String(value || "0").trim();
  return /^[+-]?\d+$/.test(raw) ? BigInt(raw) : 0n;
}

function absoluteBigInt(value: bigint) {
  return value < 0n ? -value : value;
}

function formatRawNackl(rawValue: string, decimals = 2) {
  const raw = safeBigInt(rawValue);
  const negative = raw < 0n;
  const normalizedRaw = absoluteBigInt(raw);
  const scale = 10n ** BigInt(NACKL_DECIMALS);
  const whole = normalizedRaw / scale;
  const fraction = normalizedRaw % scale;

  if (decimals <= 0) {
    const wholeOnly = addThousandsSeparator(whole.toString());
    return negative && wholeOnly !== "0" ? `-${wholeOnly}` : wholeOnly;
  }

  const padded = fraction.toString().padStart(NACKL_DECIMALS, "0");
  const kept = padded.slice(0, decimals);
  const trimmed = kept.replace(/0+$/, "");
  const wholeText = addThousandsSeparator(whole.toString());
  const amountText = trimmed ? `${wholeText}.${trimmed}` : wholeText;

  return negative && amountText !== "0" ? `-${amountText}` : amountText;
}

function formatSignedRawNackl(rawValue: string, decimals = 2) {
  const raw = safeBigInt(rawValue);

  if (raw === 0n) {
    return "0";
  }

  const sign = raw > 0n ? "+" : "-";
  return `${sign}${formatRawNackl(absoluteBigInt(raw).toString(), decimals)}`;
}

// Fix: formatRawNackl/formatSignedRawNackl trim trailing zeros ("4.00" -> "4",
// "3.60" -> "3.6"), which made every notification show a different number of
// decimal digits and broke visual alignment even before padding. This
// variant always keeps a fixed number of decimals, which grouped/monospace
// notification blocks need for their columns to actually line up.
function formatSignedRawNacklFixed(rawValue: string, decimals = 2) {
  const raw = safeBigInt(rawValue);
  const sign = raw < 0n ? "-" : "+";
  const normalizedRaw = absoluteBigInt(raw);
  const scale = 10n ** BigInt(NACKL_DECIMALS);
  const whole = normalizedRaw / scale;
  const fraction = normalizedRaw % scale;
  const padded = fraction.toString().padStart(NACKL_DECIMALS, "0");
  const kept = padded.slice(0, decimals);
  const wholeText = addThousandsSeparator(whole.toString());

  return `${sign}${wholeText}.${kept}`;
}

function getDeltaIcon(rawValue: string) {
  return safeBigInt(rawValue) < 0n ? "➖" : "➕";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function customEmoji(fallback: string, customEmojiId?: string) {
  const id = String(customEmojiId || "").trim();

  if (!id) {
    return fallback;
  }

  return `<tg-emoji emoji-id="${escapeHtml(id)}">${escapeHtml(fallback)}</tg-emoji>`;
}

function nacklIcon() {
  return customEmoji("😊", NACKL_CUSTOM_EMOJI_ID);
}

function usdcIcon() {
  return customEmoji("🔵", USDC_CUSTOM_EMOJI_ID);
}

function usesCustomEmojiMarkup() {
  return Boolean(NACKL_CUSTOM_EMOJI_ID || USDC_CUSTOM_EMOJI_ID);
}

function safeMessageText(value: unknown) {
  return usesCustomEmojiMarkup() ? escapeHtml(value) : String(value ?? "");
}

function getHtmlReplyExtra() {
  return usesCustomEmojiMarkup() ? { parse_mode: "HTML" as const } : undefined;
}

function isAdminContext(ctx: any) {
  const telegramId = ctx?.from?.id;

  if (!telegramId || BOT_ADMIN_IDS.size === 0) {
    return false;
  }

  // Respects /testmode, so an operator testing as a normal user also loses the
  // admin commands — otherwise "test mode" would only be half true.
  if (adminTestMode.has(Number(telegramId))) {
    return false;
  }

  return BOT_ADMIN_IDS.has(String(telegramId));
}

// Ignores /testmode. Only for the few things that must keep working while
// privileges are suspended: the toggle itself and the 1-star test plan.
function isRealAdminContext(ctx: any) {
  const telegramId = ctx?.from?.id;

  return Boolean(telegramId) && BOT_ADMIN_IDS.has(String(telegramId));
}

async function replyAdminOnly(ctx: any) {
  await ctx.reply("Admin-only command.");
}

async function replyWithOptionalHtml(ctx: any, message: string) {
  const extra = getHtmlReplyExtra();

  if (extra) {
    await ctx.reply(message, extra);
    return;
  }

  await ctx.reply(message);
}

async function sendMessageWithOptionalHtml(
  bot: Telegraf<any>,
  chatId: number,
  message: string,
) {
  const extra = getHtmlReplyExtra();

  if (extra) {
    await bot.telegram.sendMessage(chatId, message, extra);
    return;
  }

  await bot.telegram.sendMessage(chatId, message);
}

function formatDeltaNotificationMessage(deltaRaw: string, label: string) {
  return `${getDeltaIcon(deltaRaw)} ${formatDeltaAmount(deltaRaw)} ${nacklIcon()} NACKL | ${safeMessageText(label)}`;
}

// Fix: the earlier <pre> (multi-line code-block) version rendered as a
// separate "code snippet" bubble with its own copy-button header, which
// looked broken next to normal chat messages. Plain unpadded text (the
// version after that) looked normal but wasn't actually aligned, since
// Telegram's regular message font is proportional, not fixed-width.
// This version wraps just the amount+"NACKL" portion of each line in an
// inline <code> span: Telegram renders <code> in a fixed-width font WITHOUT
// the separate code-block chrome that <pre> triggers, so right-padding the
// amount inside that span produces a real aligned column while the message
// still reads as a normal chat message.
function buildGroupedRewardMessage(
  entries: Array<{ label: string; deltaRaw: string }>,
) {
  if (!entries.length) {
    return "";
  }

  const totalRaw = entries
    .reduce((sum, entry) => sum + safeBigInt(entry.deltaRaw), 0n)
    .toString();

  const amountTexts = entries.map((entry) =>
    formatSignedRawNacklFixed(entry.deltaRaw),
  );
  const totalText = formatSignedRawNacklFixed(totalRaw);
  const amountWidth = Math.max(
    ...amountTexts.map((text) => text.length),
    totalText.length,
  );

  const buildRow = (amountText: string, label: string) => {
    const codeSpan = `${amountText.padStart(amountWidth, " ")} NACKL`;
    return `<code>${escapeHtml(codeSpan)}</code> | ${safeMessageText(label)}`;
  };

  const rows = entries.map((entry, index) =>
    buildRow(amountTexts[index]!, entry.label),
  );

  const separator = "════════════════════";
  const totalRow = buildRow(totalText, "Total");

  return [...rows, separator, totalRow].join("\n");
}

async function sendGroupedRewardMessage(
  bot: Telegraf<any>,
  chatId: number,
  entries: Array<{ label: string; deltaRaw: string }>,
) {
  const message = buildGroupedRewardMessage(entries);

  if (!message) {
    return;
  }

  await bot.telegram.sendMessage(chatId, message, { parse_mode: "HTML" });
}

function formatDeltaAmount(rawValue: string, decimals = 2) {
  return formatRawNackl(
    absoluteBigInt(safeBigInt(rawValue)).toString(),
    decimals,
  );
}

// (getMiningEventsSince / sumMiningEvents were removed here: they read raw
// events only, which is exactly the mistake this rework fixes. Use
// sumMiningWindow, which spans raw events AND the rolled-up days.)

// Retention, reworked. The old rule was "45 days OR the last 1000 events,
// whichever is smaller", and on a busy wallet 1000 events covered as little as
// 5 days — while MONTHLY/WEEKLY still claimed to sum 30 and 7 days. 116 of 176
// watches were pinned at the 1000 cap, so those figures were silently short,
// by up to ~6x. Raising the cap would have fixed the numbers and pushed
// mining-monitor.json past 150 MB.
//
// Instead: keep raw events only for the last couple of UTC days (all that the
// HOURLY/DAILY windows need), and fold everything older into one total per
// day. A day costs ~45 bytes instead of ~138 bytes per event, so a month of
// history is a rounding error, and the monthly figure is finally exact.
const MINING_RAW_RETENTION_DAYS = 2; // today + yesterday, covers any 24h window
const MINING_DAILY_RETENTION_DAYS = 45;
// Never reached in practice (the busiest wallet writes ~200 events/day); this
// only guards against a pathological source flapping thousands of times a day.
const MINING_MAX_RAW_EVENTS = 5000;

function utcDayKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function rawRetentionStartDay(nowMs: number) {
  return utcDayKey(nowMs - (MINING_RAW_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000);
}

// Moves aged-out events into dailyTotals. Folding REMOVES the event it counted,
// so raw events and daily buckets never describe the same moment twice.
function foldMiningEvents(watch: MiningWatchRecord) {
  const now = Date.now();
  const keepFromDay = rawRetentionStartDay(now);
  const oldestDay = utcDayKey(now - MINING_DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const daily = new Map<string, bigint>();
  for (const bucket of watch.dailyTotals || []) {
    if (bucket?.day) daily.set(bucket.day, safeBigInt(bucket.deltaRaw));
  }

  const kept: MiningEvent[] = [];

  for (const event of watch.events || []) {
    const at = new Date(event.at).getTime();
    if (!Number.isFinite(at)) continue;

    const day = utcDayKey(at);
    if (day >= keepFromDay) {
      kept.push(event);
    } else {
      daily.set(day, (daily.get(day) || 0n) + safeBigInt(event.deltaRaw));
    }
  }

  watch.events = kept.slice(-MINING_MAX_RAW_EVENTS);
  watch.dailyTotals = [...daily.entries()]
    .filter(([day]) => day >= oldestDay)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, deltaRaw]) => ({ day, deltaRaw: deltaRaw.toString() }));
}

// Sums a time window across both storage tiers. Windows shorter than the raw
// retention are answered entirely from raw events; longer ones add the daily
// buckets. Buckets only exist for days older than the raw window, so the two
// halves cannot double-count. Day-level granularity means a long window is
// measured in whole UTC days — off by at most a partial boundary day, versus
// the multi-day shortfall this replaces.
function sumMiningWindow(watch: MiningWatchRecord, sinceMs: number) {
  let total = 0n;

  for (const event of watch.events || []) {
    const at = new Date(event.at).getTime();
    if (Number.isFinite(at) && at >= sinceMs) {
      total += safeBigInt(event.deltaRaw);
    }
  }

  const sinceDay = utcDayKey(sinceMs);
  const rawFromDay = rawRetentionStartDay(Date.now());

  for (const bucket of watch.dailyTotals || []) {
    if (bucket?.day && bucket.day >= sinceDay && bucket.day < rawFromDay) {
      total += safeBigInt(bucket.deltaRaw);
    }
  }

  return total.toString();
}

function getMiningSpeedRawForWallet(
  chatId: number | undefined,
  walletAddress: string,
) {
  if (!chatId) return "0";

  const watch = readMiningMonitorState().watches.find(
    (item) =>
      item.chatId === chatId &&
      item.address.toLowerCase() === walletAddress.toLowerCase(),
  );

  if (!watch) return "0";

  return sumMiningWindow(watch, Date.now() - 24 * 60 * 60 * 1000);
}

function formatSummaryDelta(rawValue: string) {
  const raw = safeBigInt(rawValue);

  if (raw === 0n) {
    return "+0 NACKL";
  }

  return `${formatSignedRawNackl(rawValue)} NACKL`;
}

function getMiningSummaryUpdatedText(watches: MiningWatchRecord[]) {
  const latestMs = watches.reduce((latest, watch) => {
    const checkedMs = new Date(
      watch.lastCheckedAt || watch.createdAt || Date.now(),
    ).getTime();
    return Number.isFinite(checkedMs) ? Math.max(latest, checkedMs) : latest;
  }, 0);

  const date = new Date(latestMs || Date.now());
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function getMiningSummaryLinesForWatch(watch: MiningWatchRecord) {
  const now = Date.now();
  const hourRaw = sumMiningWindow(watch, now - 60 * 60 * 1000);
  const dayRaw = sumMiningWindow(watch, now - 24 * 60 * 60 * 1000);
  const weekRaw = sumMiningWindow(watch, now - 7 * 24 * 60 * 60 * 1000);
  const monthRaw = sumMiningWindow(watch, now - 30 * 24 * 60 * 60 * 1000);

  // Turkish to match the rest of the bot — this used to sit inside an
  // all-English screen that no longer exists.
  return [
    `👤 ${safeMessageText(watch.label)}`,
    `Toplam: ${formatRawNackl(watch.lastLockedRaw)} NACKL`,
    `Son 1 saat: ${formatSummaryDelta(hourRaw)}`,
    `Bugün: ${formatSummaryDelta(dayRaw)}`,
    `Hafta: ${formatSummaryDelta(weekRaw)}`,
    `Ay: ${formatSummaryDelta(monthRaw)}`,
  ];
}

// Fix: adds an aggregated "TOTAL ALL WALLETS" block across every tracked
// wallet (CURRENT/HOURLY/DAILY/WEEKLY/MONTHLY, NACKL only), matching the
// per-wallet metrics above but summed. Shown at the bottom of /status and the
// periodic hourly push whenever more than one wallet is tracked.
function getMiningSummaryTotalsLines(watches: MiningWatchRecord[]) {
  const now = Date.now();

  const currentTotalRaw = watches
    .reduce((sum, watch) => sum + safeBigInt(watch.lastLockedRaw), 0n)
    .toString();
  const hourTotalRaw = watches
    .reduce(
      (sum, watch) =>
        sum +
        safeBigInt(
          sumMiningWindow(watch, now - 60 * 60 * 1000),
        ),
      0n,
    )
    .toString();
  const dayTotalRaw = watches
    .reduce(
      (sum, watch) =>
        sum +
        safeBigInt(
          sumMiningWindow(watch, now - 24 * 60 * 60 * 1000),
        ),
      0n,
    )
    .toString();
  const weekTotalRaw = watches
    .reduce(
      (sum, watch) =>
        sum +
        safeBigInt(
          sumMiningWindow(watch, now - 7 * 24 * 60 * 60 * 1000),
        ),
      0n,
    )
    .toString();
  const monthTotalRaw = watches
    .reduce(
      (sum, watch) =>
        sum +
        safeBigInt(
          sumMiningWindow(watch, now - 30 * 24 * 60 * 60 * 1000),
        ),
      0n,
    )
    .toString();

  return [
    "━━━━━━━━━━━━━━━━━━━━",
    "💰 TOTAL ALL WALLETS",
    `CURRENT: ${formatRawNackl(currentTotalRaw)} NACKL`,
    `HOURLY: ${formatSummaryDelta(hourTotalRaw)}`,
    `DAILY: ${formatSummaryDelta(dayTotalRaw)}`,
    `WEEKLY: ${formatSummaryDelta(weekTotalRaw)}`,
    `MONTHLY: ${formatSummaryDelta(monthTotalRaw)}`,
  ];
}

function buildMiningSummaryMessage(watch: MiningWatchRecord) {
  return [
    "💰 Mining Status",
    "",
    `Tracking: 1/${MINING_MONITOR_MAX_WALLETS_PER_CHAT} wallets`,
    MINING_SUMMARY_ENABLED
      ? `Summary: every ${MINING_SUMMARY_INTERVAL_MINUTES} ${MINING_SUMMARY_INTERVAL_MINUTES === 1 ? "minute" : "minutes"}`
      : "Summary: paused",
    "",
    ...getMiningSummaryLinesForWatch(watch),
    "",
    `Updated: ${getMiningSummaryUpdatedText([watch])}`,
  ].join("\n");
}

// Rewritten 2026-08-10 for the cloud-mining model. The old version was built
// for the wallet-watch product that no longer exists: it counted a per-chat
// wallet quota (/watch is gone) and advertised an hourly digest (switched off).
//
// It also filtered watches by chatId, which quietly broke for every new user:
// a connected mining wallet is now registered as a SYSTEM record (chatId 0), so
// the caller's own wallet would never be found and the screen would claim they
// had none. Wallets are therefore resolved through the miner records, and the
// reward history is looked up by wallet name regardless of who registered it.
function buildMiningSummaryStatusMessage(
  chatId?: number,
  options: { pushOnly?: boolean } = {},
) {
  const state = readMiningMonitorState();
  const miners =
    typeof chatId === "number"
      ? readBeeMinerState().miners.filter((miner) => miner.chatId === chatId)
      : readBeeMinerState().miners;

  const findWatch = (walletName: string) =>
    state.watches.find(
      (watch) =>
        String(watch.label || "").toLowerCase() === walletName.toLowerCase(),
    );

  // Legacy watches the user added back when /watch existed still belong to them.
  const ownWatches =
    typeof chatId === "number"
      ? state.watches.filter((watch) => watch.chatId === chatId)
      : [];

  const lines: string[] = ["📊 Durum", ""];

  if (typeof chatId === "number") {
    const subscription = readPaymentsState().subscriptions[String(chatId)];
    const activeUntilMs = subscription
      ? new Date(subscription.activeUntil).getTime()
      : 0;

    if (activeUntilMs > Date.now()) {
      const daysLeft = Math.max(
        1,
        Math.ceil((activeUntilMs - Date.now()) / (24 * 60 * 60 * 1000)),
      );
      lines.push(
        `💎 Abonelik: ${subscription!.planId}${subscription!.trial ? " (deneme)" : ""} — ${daysLeft} gün kaldı`,
      );
    } else {
      lines.push(
        `💎 Aboneliğin yok — ${TRIAL_DAYS} gün ücretsiz denemek için /trial`,
      );
    }

    lines.push("");
  }

  if (!miners.length && !ownWatches.length) {
    lines.push(
      "Bağlı madencilik cüzdanın yok.",
      "",
      "1) /miner_connect <cüzdan adı>",
      "2) /miner_check",
      "3) /miner_start",
    );

    return lines.join("\n");
  }

  const ago = (iso?: string | null) => {
    const ms = iso ? Date.now() - Date.parse(iso) : NaN;

    if (!Number.isFinite(ms) || ms < 0) return "—";
    if (ms < 60_000) return "az önce";

    return `${Math.round(ms / 60000)} dk önce`;
  };

  for (const miner of miners) {
    lines.push(`⛏️ ${safeMessageText(miner.walletName)} — ${miner.status}`);

    if (typeof miner.lastTapSum === "number") {
      const pct = Math.min(
        100,
        Math.round((miner.lastTapSum / BEE_CYCLE_TAP_CAP) * 100),
      );
      lines.push(
        `Döngü: ${miner.lastTapSum.toLocaleString("tr-TR")} / ${BEE_CYCLE_TAP_CAP.toLocaleString("tr-TR")} tap (%${pct})`,
      );
    }

    lines.push(
      `Son oturum: ${ago(miner.lastSessionAt)} · Son ödül: ${ago(miner.lastRewardAt)}`,
    );

    const watch = findWatch(miner.walletName);

    if (watch) {
      // Reuse the existing reward aggregates; only the framing changed.
      lines.push(...getMiningSummaryLinesForWatch(watch).slice(1));
    }

    lines.push("");
  }

  // Wallets the user watches but does not mine with — kept so nobody's old
  // records silently vanish from view.
  const extraWatches = ownWatches.filter(
    (watch) =>
      !miners.some(
        (miner) =>
          miner.walletName.toLowerCase() ===
          String(watch.label || "").toLowerCase(),
      ),
  );

  const visibleExtra = options.pushOnly
    ? extraWatches.filter((watch) => isMiningWatchNotificationEnabled(watch))
    : extraWatches;

  for (const watch of visibleExtra) {
    lines.push(...getMiningSummaryLinesForWatch(watch), "");
  }

  lines.push("🌐 Detaylı takip: ackinackiradar.com");

  return lines.join("\n");
}

function getMiningWatchAddedDate(watch: MiningWatchRecord) {
  const date = new Date(watch.createdAt);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toISOString().slice(0, 10);
}

function isMiningWatchNotificationEnabled(watch: MiningWatchRecord) {
  return watch.notificationsEnabled !== false;
}

function buildWalletSettingsMessage(watch: MiningWatchRecord) {
  return [
    `🛠️ Settings: ${watch.label}`,
    "",
    `😊 Balance: ${formatRawNackl(watch.lastLockedRaw)} NACKL`,
    `📡 Source: ${watch.lastSourceStatus === "unavailable" ? "unavailable" : "ok"}`,
    `📅 Added: ${getMiningWatchAddedDate(watch)}`,
    `🔔 Notifications: ${isMiningWatchNotificationEnabled(watch) ? "ON" : "OFF"}`,
  ].join("\n");
}

function buildWalletSettingsKeyboard(watch: MiningWatchRecord) {
  const key = createMiningWatchCallbackKey(watch);
  const enabled = isMiningWatchNotificationEnabled(watch);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        enabled ? "🔕 Disable notifications" : "🔔 Enable notifications",
        `mw:toggle:${key}`,
      ),
    ],
    [Markup.button.callback("🗑️ Delete wallet", `mw:delete:${key}`)],
    [Markup.button.callback("◀️ Back to list", "mw:list")],
  ]);
}

function buildWalletListKeyboard(watches: MiningWatchRecord[]) {
  return Markup.inlineKeyboard([
    ...watches.map((watch) => [
      Markup.button.callback(
        `⚙️ ${watch.label}`,
        `mw:show:${createMiningWatchCallbackKey(watch)}`,
      ),
    ]),
    [Markup.button.callback("➕ Add wallet", "mining_watch_prompt")],
  ]);
}

function buildWalletListMessage(watches: MiningWatchRecord[]) {
  return [
    "👛 Wallet Management",
    "",
    ...watches.map((watch, index) => {
      const status = isMiningWatchNotificationEnabled(watch)
        ? "🔔 ON"
        : "🔕 OFF";
      const sourceStatus =
        watch.lastSourceStatus === "unavailable" ? " — source: -" : "";
      return `${index + 1}. ${watch.label} — ${formatRawNackl(watch.lastLockedRaw)} $NACKL — ${status}${sourceStatus}`;
    }),
    "",
    "Select a wallet to manage notifications or delete it.",
    "",
    "💡 Not: Birden fazla wallet'ı aynı bildirimde (tek mesajda) görmek istiyorsan, madenciliği hepsinde aynı dönemde (aynı epoch'ta) başlatman gerekiyor. Farklı dönemlerde başlayan wallet'ların ödülleri ayrı zamanlarda geldiği için bildirimleri de ayrı gelir.",
  ].join("\n");
}

function createReferralCode(telegramId: number) {
  return `bee_${telegramId}`;
}

function getStartPayload(text?: string) {
  if (!text) return undefined;

  const parts = text.trim().split(" ");
  if (parts.length < 2) return undefined;

  return parts[1];
}

function getIstanbulDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(date);
}

function getUserDisplayName(user: UserRecord) {
  if (user.username) {
    return `@${user.username}`;
  }

  return user.firstName;
}

function registerOrGetUser(params: {
  telegramId: number;
  firstName: string;
  username?: string | undefined;
  referredBy?: string | undefined;
}) {
  const users = readUsers();
  const existing = users.find((user) => user.telegramId === params.telegramId);

  if (existing) {
    existing.firstName = params.firstName;

    if (params.username) {
      existing.username = params.username;
    }

    writeUsers(users);

    return {
      user: existing,
      isNew: false,
    };
  }

  const newUser: UserRecord = {
    telegramId: params.telegramId,
    firstName: params.firstName,
    username: params.username,
    referralCode: createReferralCode(params.telegramId),
    referredBy: params.referredBy,
    points: 100,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);

  if (params.referredBy) {
    const referrer = users.find(
      (user) => user.referralCode === params.referredBy,
    );

    if (referrer && referrer.telegramId !== params.telegramId) {
      referrer.points += 50;
    }
  }

  writeUsers(users);

  return {
    user: newUser,
    isNew: true,
  };
}

function findUserByTelegramId(telegramId: number) {
  const users = readUsers();
  return users.find((user) => user.telegramId === telegramId);
}

// Labels double as the router: a reply-keyboard tap arrives as a plain text
// message, so the constants are matched with bot.hears further down. Changing
// one here without changing the handler silently breaks that button.
// English, like the rest of the bot's surface: the user base is mostly outside
// Turkey (svetka, ijeoma, jharyono, alifahri77 …), and a Turkish-only menu
// would be unreadable to most of them.
// Sent verbatim with force_reply and compared verbatim when the answer comes
// back, so the two must stay identical — hence a constant, not a literal.
const WALLET_ADD_PROMPT = "Send the Acki Nacki wallet name you want to connect:";
const WALLET_INFO_PROMPT = [
  "🔍 Cüzdan Bilgisi",
  "",
  "Acki Nacki cüzdan adını veya 0: ile başlayan adresini gönder.",
  "Örnek: ackerman",
].join("\n");
const WALLET_INFO_INPUT_TTL_MS = 5 * 60 * 1000;
const pendingWalletInfoInputs = new Map<number, number>();

const MENU_PLANS = "⭐ Pay with Stars";
const MENU_TRIAL = "🎁 3-Day Trial";
const MENU_WALLETS = "👛 Wallets";
const MENU_PANEL = "🌐 Dashboard";
const MENU_HELP = "ℹ️ Help";
const DASHBOARD_MINI_APP_URL = "https://ackinackiradar.com/?tgapp=4";

// The bot's one job is selling with Telegram Stars. Mining management, wallet
// lookup and status all live on the dashboard, which already has the endpoints
// (miner connect/check/start/stop) and the UI for them. Keeping second copies
// here meant two surfaces to maintain and two to drift apart.
// Wallets screen, button-driven rather than a list of commands to retype.
// Two separate bars on purpose: one row per wallet for control (pause/resume
// and remove), and a bar of its own for adding — mixing them is how you end up
// deleting a wallet you meant to start.
//
// Callback data uses an "mn:" prefix, NOT "mw:": that older prefix belonged to
// the removed wallet-watch UI and is now swallowed by a catch-all handler that
// answers "this feature was removed".
function buildWalletsKeyboard(miners: BeeMinerRecord[]) {
  // Typed loosely on purpose: the rows mix callback buttons with a url button,
  // and inference from the first rows would lock the array to callbacks only.
  const rows: any[][] = miners.map((miner) => {
    const running = miner.status === "active";

    return [
      Markup.button.callback(
        `${running ? "⏸" : "▶️"} ${miner.walletName}`,
        `mn:tg:${miner.walletName}`,
      ),
      Markup.button.callback("🗑", `mn:rm:${miner.walletName}`),
    ];
  });

  rows.push([Markup.button.callback("➕ Add wallet", "mn:add")]);
  rows.push([Markup.button.url("🌐 Dashboard", "https://ackinackiradar.com")]);

  return Markup.inlineKeyboard(rows);
}

function formatEpochRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function buildEpochClockText(): string {
  const clock = getChainEpochClock();
  if (!clock) return "⏱ Zincir epochu: senkronizasyon bekleniyor";

  const ageSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(clock.observedAt).getTime()) / 1000),
  );

  if (!Number.isFinite(ageSeconds) || ageSeconds > 120) {
    return `⏱ Zincir epochu: ${clock.epochStart} · saat yenileniyor`;
  }

  return `⏱ Zincir epochu: ${clock.epochStart} · kalan ${formatEpochRemaining(clock.remainingSeconds - ageSeconds)}`;
}

const MINING_CYCLE_BLOCK_PERIOD = 262_000;
const MINING_CYCLE_BLOCKS_PER_SECOND = 3.0;

function buildMiningCycleRemainingText(): string {
  const clock = getChainEpochClock();
  let currentSeqNo: number | null = null;
  let dataAgeSeconds = Number.POSITIVE_INFINITY;

  if (clock) {
    const observedAtMs = new Date(clock.observedAt).getTime();
    dataAgeSeconds = Math.max(0, (Date.now() - observedAtMs) / 1000);
    if (Number.isFinite(dataAgeSeconds) && dataAgeSeconds <= 10 * 60) {
      currentSeqNo = Math.floor(
        clock.currentSeqNo +
          dataAgeSeconds * MINING_CYCLE_BLOCKS_PER_SECOND,
      );
    }
  }

  // The web sampler persists every successful Mainnet height. This survives a
  // bot restart, unlike the in-memory 5-minute epoch clock, so /epoch can answer
  // immediately even while the shared GraphQL block pool is temporarily busy.
  if (currentSeqNo === null) {
    try {
      const snapshot = JSON.parse(
        fs.readFileSync(path.join(dataDir, "chain-stats-snapshot.json"), "utf8"),
      );
      const latestBlock = Number(snapshot?.data?.latestBlock);
      const atMs = Number(snapshot?.atMs);
      dataAgeSeconds = Math.max(0, (Date.now() - atMs) / 1000);

      if (
        Number.isFinite(latestBlock) &&
        latestBlock > 0 &&
        Number.isFinite(dataAgeSeconds) &&
        dataAgeSeconds <= 24 * 60 * 60
      ) {
        currentSeqNo = Math.floor(
          latestBlock + dataAgeSeconds * MINING_CYCLE_BLOCKS_PER_SECOND,
        );
      }
    } catch {
      currentSeqNo = null;
    }
  }

  if (currentSeqNo === null) {
    return "⏳ Madencilik döngüsü: zincir yüksekliği şu anda alınamıyor.";
  }
  const elapsedBlocks =
    ((currentSeqNo % MINING_CYCLE_BLOCK_PERIOD) +
      MINING_CYCLE_BLOCK_PERIOD) %
    MINING_CYCLE_BLOCK_PERIOD;
  const remainingBlocks = Math.max(
    0,
    MINING_CYCLE_BLOCK_PERIOD - elapsedBlocks,
  );
  const remainingSeconds = Math.ceil(
    remainingBlocks / MINING_CYCLE_BLOCKS_PER_SECOND,
  );
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  return `⏳ Sonraki epoch'a kalan: ${hours} sa ${minutes} dk`;
}

function buildWalletsText(miners: BeeMinerRecord[]) {
  if (!miners.length) {
    return [
      "👛 Your wallets (0)",
      "",
      buildEpochClockText(),
      "",
      "No wallet connected yet. Press “Add wallet” to start.",
    ].join("\n");
  }

  return [
    `👛 Your wallets (${miners.length})`,
    "",
    buildEpochClockText(),
    "",
    ...miners.map(
      (miner) => `• ${safeMessageText(miner.walletName)} — ${miner.status}`,
    ),
    "",
    "▶️/⏸ start or pause · 🗑 remove (deletes the stored keys)",
  ].join("\n");
}

async function sendWalletsScreen(ctx: any) {
  const chatId = ctx.chat?.id;
  const miners = chatId
    ? readBeeMinerState().miners.filter((m) => m.chatId === chatId)
    : [];

  await ctx.reply(buildWalletsText(miners), buildWalletsKeyboard(miners));
}

function buildMainKeyboard() {
  return Markup.keyboard([
    ["/start 🚀", "/info 🔍"],
    ["/epoch ⏳", "/trial 🎁"],
    ["/help ℹ️"],
  ]).resize();
}

async function promptWalletInfo(ctx: any) {
  const chatId = Number(ctx.chat?.id);
  if (Number.isFinite(chatId)) {
    pendingWalletInfoInputs.set(chatId, Date.now() + WALLET_INFO_INPUT_TTL_MS);
  }
  await ctx.reply(WALLET_INFO_PROMPT, buildMainKeyboard());
}

function buildMainMenu() {
  const buttons = [
    [
      Markup.button.url("🌐 Dashboard", "https://ackinackiradar.com"),
    ],
    [Markup.button.callback("🔍 Wallet Info", "wallet_info")],
    [Markup.button.callback("ℹ️ Help", "help")],
  ];

  return Markup.inlineKeyboard(buttons);
}

function buildWelcomeMessage(_languageCode?: string) {
  return [
    "📡 Welcome to Acki Nacki Radar",
    "",
    "Track wallet insights, NACKL balances, MBI levels, Mainnet data and mining activity in one place.",
    "",
    "This is not an official Acki Nacki platform.",
    "",
    "Choose an action below:",
  ].join("\n");
}

// Shown once, right after the welcome card, so a brand-new user sees the
// whole login -> connect -> mine path before they have to guess at it.
function buildHowToUseMessage(_languageCode?: string) {
  return [
    "📖 Getting Started",
    "",
    `1) 🎁 Start your free ${TRIAL_DAYS}-day gift with /trial. No payment is required.`,
    "2) Press the Dashboard button on the left. The Mini App recognizes your Telegram account automatically.",
    "3) Open Cloud Miner from the Dashboard menu.",
    "4) Enter your Acki Nacki wallet name and press Connect Wallet.",
    "5) Open AN Wallet and approve the mining-key request.",
    "6) Return to Cloud Miner, press Check, then start mining after verification.",
    `7) When the ${TRIAL_DAYS}-day gift ends, an active plan is required to continue mining. Buy one in Plans with Stars, USDT/TON or NACKL.`,
    "",
    "Need help? Use /help.",
  ].join("\n");
}

function buildHelpMessage(_languageCode?: string) {
  return [
    "📡 Acki Nacki Radar — Help",
    "",
    "Track Acki Nacki wallets, chain data and mining cycles in one place.",
    "",
    "Commands",
    "",
    "🚀 /start",
    "Open the main menu and getting-started guide.",
    "",
    "🔍 /info",
    "Look up a wallet name or an address starting with 0: and show its balance, MBI and chain details.",
    "",
    "🎁 /trial",
    `Start a free ${TRIAL_DAYS}-day Cloud Miner gift with no payment required. Available once per account.`,
    "",
    "⏳ /epoch",
    "Show the hours and minutes remaining until the next mining epoch.",
    "",
    "ℹ️ /help",
    "Open this help screen.",
    "",
    "Community & contact",
    "👤 Telegram: https://t.me/smhgkts",
    "👥 Group: https://t.me/ackinackiradar",
    "📢 Channel: https://t.me/Ackinackiradarofficial",
    "𝕏 X / Contact: https://x.com/elturko_sg",
    "",
    "Note: This is a community-built radar bot; it is not an official Acki Nacki product.",
  ].join("\n");
}

function buildWalletInfoPrompt() {
  return [
    "🔍 Wallet Info",
    "",
    "Send a wallet name or address with /info.",
    "",
    "Example:",
    "/info ackerman",
    "/info ackerman wallet2 wallet3",
    "/info 0:3d2cae...",
  ].join("\n");
}

function buildMiningWatchPrompt() {
  return [
    "⛏️ Wallet Scan",
    "",
    "Track a wallet and get a message when locked NACKL changes.",
    `Limit: ${MINING_MONITOR_MAX_WALLETS_PER_CHAT} wallets per account`,
    `Source: ${MINING_MONITOR_SOURCE_LABEL}`,
    "",
    "Examples:",
    "/watch ackerman",
    "/wallets",
    "/unwatch ackerman",
    "/status",
  ].join("\n");
}

function buildComingSoonMessage() {
  return [
    "⏳ Coming soon",
    "",
    "This feature is not live yet.",
    "For now, Wallet Info is active.",
    "",
    "Try:",
    "/info ackerman",
  ].join("\n");
}

function getCommandArgument(text?: string) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ").trim() : "";
}

function addThousandsSeparator(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatCompactAmount(value?: string | null, decimals = 2) {
  const raw = String(value || "0")
    .trim()
    .replace(/,/g, "");

  if (!raw || !/^[+-]?\d+(\.\d+)?$/.test(raw)) {
    return "0";
  }

  const negative = raw.startsWith("-");
  const normalized = raw.replace(/^[+-]/, "");
  const [wholePartRaw, fractionPartRaw = ""] = normalized.split(".");
  let whole = BigInt(wholePartRaw || "0");

  if (decimals <= 0) {
    const shouldRound = Number(fractionPartRaw[0] || "0") >= 5;
    if (shouldRound) whole += 1n;

    const result = addThousandsSeparator(whole.toString());
    return negative && result !== "0" ? `-${result}` : result;
  }

  const paddedFraction = fractionPartRaw.padEnd(decimals + 1, "0");
  let kept = paddedFraction.slice(0, decimals);
  const roundDigit = Number(paddedFraction[decimals] || "0");

  if (roundDigit >= 5) {
    const roundedFraction = BigInt(kept || "0") + 1n;
    const roundedText = roundedFraction.toString().padStart(decimals, "0");

    if (roundedText.length > decimals) {
      whole += 1n;
      kept = "0".repeat(decimals);
    } else {
      kept = roundedText;
    }
  }

  const isZero = whole === 0n && /^0+$/.test(kept);

  if (isZero) {
    return "0";
  }

  const result = `${addThousandsSeparator(whole.toString())}.${kept}`;
  return negative ? `-${result}` : result;
}

function getTokenAmount(
  tokens: Array<{ symbol: string; balanceFormatted: string }>,
  symbol: string,
) {
  const token = tokens.find(
    (item) => item.symbol.toUpperCase() === symbol.toUpperCase(),
  );

  return token ? formatCompactAmount(token.balanceFormatted) : "0";
}

function formatUnixDate(seconds?: number | null) {
  if (!seconds) return "-";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(seconds * 1000))
    .replace(",", "");
}

function formatTimeAgo(seconds?: number | null) {
  if (!seconds) return "-";

  const diffSeconds = Math.max(0, Math.floor(Date.now() / 1000 - seconds));

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;

  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function buildWalletInfoMessage(
  wallet: Awaited<ReturnType<typeof getAckiWalletActivity>>,
  chatId?: number,
) {
  const displayName = wallet.name || wallet.input || wallet.address;
  const nackl = getTokenAmount(wallet.tokens, "NACKL");
  const locked = getTokenAmount(wallet.lockedTokens || [], "NACKL");
  const usdc = getTokenAmount(wallet.tokens, "USDC");
  const shell = getTokenAmount(wallet.tokens, "SHELL");
  const lastActivity = wallet.popitGame?.lastPaid || wallet.lastPaid;
  const speedRaw24h = getMiningSpeedRawForWallet(chatId, wallet.address);

  return [
    "📡 Wallet Radar",
    "",
    `👤 ${safeMessageText(displayName)}`,
    `├ ${nacklIcon()} NACKL: ${nackl}`,
    `├ 🔒 Locked: ${locked}`,
    `├ ${usdcIcon()} USDC: ${usdc}`,
    `├ 🐚 SHELL: ${shell}`,
    `├ ⚡ Speed: ${formatRawNackl(speedRaw24h)} NACKL/24h`,
    `├ 🎮 MBI Level: ${safeMessageText(wallet.mamaboardLevel || "-")}`,
    `├ 🕒 Last activity: ${formatUnixDate(lastActivity)}`,
    `└ ⏱️ Last tap: ${formatTimeAgo(lastActivity)}`,
  ].join("\n");
}

function parseWalletInfoInputs(input: string) {
  return Array.from(
    new Set(
      String(input || "")
        .split(/[\s,;]+/)
        .map((item) => normalizeMiningInput(item))
        .filter(Boolean),
    ),
  );
}

function buildWalletInfoUsageMessage() {
  return [
    "Usage: /info <address_or_wallet_name>",
    "",
    "Examples:",
    "/info ackerman",
    "/info ackerman wallet2 wallet3",
    "/info 0:3d2cae...",
  ].join("\n");
}

// Shared by the /info command's single-wallet path and the website search
// box's /start?start=info_<input> deep link (see bot.start below) — same
// lookup, same error copy, one place to keep them in sync.
// Wallets join the radar by being used, not by being subscribed to. /info
// lookups and cloud-mining connections both land here.
//
// These are SYSTEM records, not owned by whoever ran the lookup: /info can be
// pointed at anyone's wallet, so filing it under the caller's chatId would put
// strangers' wallets in their list and burn their per-chat quota. chatId 0 has
// no chat to notify, and notificationsEnabled:false keeps it out of every
// notify path even if notifications are switched back on.
const SYSTEM_WATCH_CHAT_ID = 0;
const MINING_MONITOR_MAX_SYSTEM_WATCHES_RAW = Number(
  process.env.MINING_MONITOR_MAX_SYSTEM_WATCHES || 2000,
);
// The state file is already ~7.5MB and gets parsed on every tick, so growth
// driven by arbitrary lookups needs a ceiling rather than none at all.
const MINING_MONITOR_MAX_SYSTEM_WATCHES = Number.isFinite(
  MINING_MONITOR_MAX_SYSTEM_WATCHES_RAW,
)
  ? Math.max(0, Math.floor(MINING_MONITOR_MAX_SYSTEM_WATCHES_RAW))
  : 2000;

function registerSystemMiningWatch(wallet: any): "added" | "exists" | "skipped" {
  try {
    const address = String(wallet?.address || "").trim();
    const popitGameAddress = wallet?.popitGame?.address || null;

    // Without a PopitGame account there is nothing for the scan to read.
    if (!address || !popitGameAddress) {
      return "skipped";
    }

    const state = readMiningMonitorState();
    const addressKey = address.toLowerCase();

    // Already scanned under ANY chat — a second copy would only double the
    // reads for the same source.
    if (
      state.watches.some(
        (watch) => String(watch.address || "").toLowerCase() === addressKey,
      )
    ) {
      return "exists";
    }

    const systemCount = state.watches.filter(
      (watch) => watch.chatId === SYSTEM_WATCH_CHAT_ID,
    ).length;

    if (systemCount >= MINING_MONITOR_MAX_SYSTEM_WATCHES) {
      return "skipped";
    }

    const now = new Date().toISOString();
    const lockedRaw = getLockedNacklRawForMonitor(wallet);
    const label = String(wallet?.name || address);

    state.watches.push({
      id: `${SYSTEM_WATCH_CHAT_ID}:${address}`,
      chatId: SYSTEM_WATCH_CHAT_ID,
      input: label,
      label,
      address,
      popitGameAddress,
      lastLockedRaw: lockedRaw,
      lastTransactionLt: getPopitLastTransactionLt(wallet),
      lastMonitorSourceKey: getPopitMonitorSourceKey(wallet, lockedRaw),
      lastActivityAt: wallet?.popitGame?.lastPaid || wallet?.lastPaid || null,
      createdAt: now,
      lastCheckedAt: now,
      notificationsEnabled: false,
      lastSourceStatus: "ok",
      lastSourceError: undefined,
      events: [],
      dailyTotals: [],
    });

    writeMiningMonitorState(state);
    console.log("Wallet joined radar from lookup:", {
      label,
      address,
      systemWatches: systemCount + 1,
    });

    return "added";
  } catch (error) {
    // Registration is a side effect of a lookup — it must never break the
    // reply the user actually asked for.
    console.warn("System wallet registration failed:", {
      message: error instanceof Error ? error.message : String(error),
    });
    return "skipped";
  }
}

// Deletion survived the /wallets teardown as its own command: a user must be
// able to get their wallet out of our data even though there is no management
// UI any more.  With no argument it lists what the caller actually has, since
// otherwise there is no way to know what there is to delete.
//
// A plain user can only delete their OWN records. System records (the ones
// /info lookups create) are shared radar data that feeds the public site, so
// letting anyone drop them would let one person quietly shrink everyone's
// stats — those are admin-only.
async function replyForgetWallet(ctx: any) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.reply("Chat bilgisi alınamadı.");
    return;
  }

  const input = normalizeMiningInput(getCommandArgument(ctx.message?.text));
  const isAdmin = isAdminContext(ctx);
  const state = readMiningMonitorState();
  const owned = state.watches.filter((watch) => watch.chatId === chatId);

  if (!input) {
    if (!owned.length) {
      await ctx.reply(
        [
          "🗑️ Cüzdan kaydı silme",
          "",
          "Bu sohbete ait kayıtlı cüzdan yok.",
        ].join("\n"),
      );
      return;
    }

    await ctx.reply(
      [
        "🗑️ Cüzdan kaydı silme",
        "",
        "Kayıtlı cüzdanların:",
        ...owned.map((watch) => `• ${watch.label || watch.input}`),
        "",
        "Silmek için: /forget ackerman",
        "Hepsini silmek için: /forget all",
      ].join("\n"),
    );
    return;
  }

  const before = state.watches.length;

  if (input.toLowerCase() === "all") {
    state.watches = state.watches.filter((watch) => watch.chatId !== chatId);
    writeMiningMonitorState(state);
    await ctx.reply(
      `Bu sohbete ait ${before - state.watches.length} cüzdan kaydı silindi.`,
    );
    return;
  }

  const normalizedInput = input.toLowerCase();
  const matches = (watch: MiningWatchRecord) =>
    watch.input.toLowerCase() === normalizedInput ||
    watch.label.toLowerCase() === normalizedInput ||
    watch.address.toLowerCase() === normalizedInput ||
    watch.address.toLowerCase() === `0:${normalizedInput}`;

  state.watches = state.watches.filter((watch) => {
    const deletable =
      watch.chatId === chatId ||
      (isAdmin && watch.chatId === SYSTEM_WATCH_CHAT_ID);

    if (!deletable) return true;

    return !matches(watch);
  });

  const removed = before - state.watches.length;

  if (!removed) {
    await ctx.reply(
      [
        `"${input}" için kayıt bulunamadı.`,
        "",
        "Kayıtlarını görmek için argümansız: /forget",
      ].join("\n"),
    );
    return;
  }

  writeMiningMonitorState(state);
  await ctx.reply(`Cüzdan kaydı silindi: ${input} (${removed} kayıt)`);
}

async function sendSingleWalletInfo(ctx: any, input: string) {
  try {
    const wallet = await getAckiWalletActivity(input);
    registerSystemMiningWatch(wallet);
    await replyWithOptionalHtml(
      ctx,
      buildWalletInfoMessage(wallet, ctx.chat?.id),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "WALLET_INFO_UNAVAILABLE";

    if (
      message === "INVALID_ACKI_WALLET_INPUT" ||
      message === "INVALID_ACKI_WALLET_ADDRESS"
    ) {
      await ctx.reply(
        "Wallet adı veya adres formatı geçersiz. Örnek: /info ackerman",
      );
      return;
    }

    if (
      message === "ACKI_NAME_NOT_FOUND" ||
      message === "ACKI_WALLET_NOT_FOUND"
    ) {
      await ctx.reply(
        "Wallet bulunamadı. Wallet adını veya adresi kontrol et.",
      );
      return;
    }

    await ctx.reply("Wallet bilgisi alınamadı. Biraz sonra tekrar dene.");
  }
}

async function replyWalletInfo(ctx: any, inputOverride?: string) {
  const input = String(
    inputOverride ?? getCommandArgument(ctx.message?.text),
  ).trim();

  if (!input || input === "🔍") {
    await promptWalletInfo(ctx);
    return;
  }

  const inputs = parseWalletInfoInputs(input);

  if (!inputs.length) {
    await promptWalletInfo(ctx);
    return;
  }

  if (inputs.length > MINING_MONITOR_MAX_WALLETS_PER_CHAT) {
    await ctx.reply(
      `Tek seferde en fazla ${MINING_MONITOR_MAX_WALLETS_PER_CHAT} wallet sorgulanabilir.`,
    );
    return;
  }

  if (inputs.length === 1) {
    await sendSingleWalletInfo(ctx, inputs[0]!);
    return;
  }

  const results = await Promise.allSettled(
    inputs.map((item) => getAckiWalletActivity(item)),
  );
  const cards = results.map((result, index) => {
    const originalInput = inputs[index] || "wallet";

    if (result.status === "fulfilled") {
      registerSystemMiningWatch(result.value);
      return buildWalletInfoMessage(result.value, ctx.chat?.id);
    }

    const message =
      result.reason instanceof Error
        ? result.reason.message
        : "WALLET_INFO_UNAVAILABLE";

    if (
      message === "INVALID_ACKI_WALLET_INPUT" ||
      message === "INVALID_ACKI_WALLET_ADDRESS"
    ) {
      return [
        `📡 Wallet Radar`,
        "",
        `👤 ${safeMessageText(originalInput)}`,
        "└ Wallet adı veya adres formatı geçersiz.",
      ].join("\n");
    }

    if (
      message === "ACKI_NAME_NOT_FOUND" ||
      message === "ACKI_WALLET_NOT_FOUND"
    ) {
      return [
        `📡 Wallet Radar`,
        "",
        `👤 ${safeMessageText(originalInput)}`,
        "└ Wallet bulunamadı.",
      ].join("\n");
    }

    return [
      `📡 Wallet Radar`,
      "",
      `👤 ${safeMessageText(originalInput)}`,
      "└ Wallet bilgisi alınamadı.",
    ].join("\n");
  });

  let chunk = "";
  for (const card of cards) {
    const next = chunk ? `${chunk}\n\n${card}` : card;

    if (next.length > 3600 && chunk) {
      await replyWithOptionalHtml(ctx, chunk);
      chunk = card;
    } else {
      chunk = next;
    }
  }

  if (chunk) {
    await replyWithOptionalHtml(ctx, chunk);
  }
}

async function replyWatchMining(ctx: any) {
  const input = normalizeMiningInput(getCommandArgument(ctx.message?.text));

  if (!input) {
    await ctx.reply(buildMiningWatchPrompt());
    return;
  }

  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.reply("Chat bilgisi alınamadı.");
    return;
  }

  try {
    const state = readMiningMonitorState();
    const existingForChat = state.watches.filter(
      (watch) => watch.chatId === chatId,
    );

    if (existingForChat.length >= MINING_MONITOR_MAX_WALLETS_PER_CHAT) {
      await ctx.reply(
        `Bu sohbet için en fazla ${MINING_MONITOR_MAX_WALLETS_PER_CHAT} wallet izlenebilir.`,
      );
      return;
    }

    const wallet = await getAckiWalletActivity(input);
    const label = wallet.name || input;
    const watchId = createMiningWatchId(chatId, wallet.address);
    const existing = state.watches.find((watch) => watch.id === watchId);
    const lockedRaw = getLockedNacklRawForMonitor(wallet);
    const now = new Date().toISOString();

    if (existing) {
      existing.input = input;
      existing.label = label;
      existing.popitGameAddress =
        wallet.popitGame?.address || existing.popitGameAddress || null;
      existing.lastTransactionLt =
        getPopitLastTransactionLt(wallet) || existing.lastTransactionLt || null;
      existing.lastMonitorSourceKey =
        getPopitMonitorSourceKey(wallet, existing.lastLockedRaw) ||
        existing.lastMonitorSourceKey ||
        null;
      existing.lastActivityAt =
        wallet.popitGame?.lastPaid ||
        wallet.lastPaid ||
        existing.lastActivityAt ||
        null;
      existing.lastCheckedAt = now;
      existing.notificationsEnabled = existing.notificationsEnabled !== false;
      existing.lastSourceStatus = "ok";
      existing.lastSourceError = undefined;

      const previousRaw = existing.lastLockedRaw;
      const result = await updateMiningWatchRecord(existing, undefined, {
        sendNotifications: false,
      });
      writeMiningMonitorState(state);

      const detectedDelta = safeBigInt(result.deltaRaw);

      await ctx.reply(
        [
          "⛏️ Cüzdan taraması zaten aktif ✅",
          "",
          `Wallet: ${existing.label}`,
          `Current locked: ${formatRawNackl(existing.lastLockedRaw)} $NACKL`,
          detectedDelta !== 0n
            ? `Detected since last check: ${formatSignedRawNackl(result.deltaRaw)} $NACKL`
            : `Previous locked: ${formatRawNackl(previousRaw)} $NACKL`,
          `Notifications: ${isMiningWatchNotificationEnabled(existing) ? "ON" : "OFF"}`,
          "",
          "Değişim oldukça mesaj atacağım.",
        ].join("\n"),
      );
      return;
    }

    state.watches.push({
      id: watchId,
      chatId,
      input,
      label,
      address: wallet.address,
      popitGameAddress: wallet.popitGame?.address || null,
      lastLockedRaw: lockedRaw,
      lastTransactionLt: getPopitLastTransactionLt(wallet),
      lastMonitorSourceKey: getPopitMonitorSourceKey(wallet, lockedRaw),
      lastActivityAt: wallet.popitGame?.lastPaid || wallet.lastPaid || null,
      createdAt: now,
      lastCheckedAt: now,
      notificationsEnabled: true,
      lastSourceStatus: "ok",
      lastSourceError: undefined,
      events: [],
      dailyTotals: [],
    });

    writeMiningMonitorState(state);

    const totalForChat = state.watches.filter(
      (watch) => watch.chatId === chatId,
    ).length;

    const multiWalletTip =
      totalForChat > 1
        ? [
            "",
            "💡 Not: Birden fazla wallet'ı aynı bildirimde (tek mesajda) görmek istiyorsan, madenciliği hepsinde aynı dönemde (aynı epoch'ta) başlatman gerekiyor. Farklı dönemlerde başlayan wallet'ların ödülleri ayrı zamanlarda geldiği için bildirimleri de ayrı gelir.",
          ]
        : [];

    await ctx.reply(
      [
        "⛏️ Cüzdan taraması başladı ✅",
        "",
        `Wallet: ${label}`,
        `Current locked: ${formatRawNackl(lockedRaw)} $NACKL`,
        `Check interval: ${Math.round(MINING_MONITOR_INTERVAL_MS / 1000)}s`,
        `Summary push: every ${MINING_SUMMARY_INTERVAL_MINUTES} ${MINING_SUMMARY_INTERVAL_MINUTES === 1 ? "minute" : "minutes"}`,
        "",
        "Locked NACKL değiştiğinde bildirim göndereceğim.",
        ...multiWalletTip,
      ].join("\n"),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "MINING_MONITOR_UNAVAILABLE";

    if (
      message === "INVALID_ACKI_WALLET_INPUT" ||
      message === "INVALID_ACKI_WALLET_ADDRESS"
    ) {
      await ctx.reply(
        "Wallet adı veya adres formatı geçersiz. Örnek: /watch ackerman",
      );
      return;
    }

    if (message === "POPIT_LOCKED_SOURCE_UNAVAILABLE") {
      await ctx.reply(
        "Bu wallet için PopitGame locked NACKL kaynağı bulunamadı. Monitor sadece locked NACKL kaynağı doğrulanınca başlatılır.",
      );
      return;
    }

    if (
      message === "ACKI_NAME_NOT_FOUND" ||
      message === "ACKI_WALLET_NOT_FOUND"
    ) {
      await ctx.reply(
        "Wallet bulunamadı. Wallet adını veya adresi kontrol et.",
      );
      return;
    }

    await ctx.reply(
      "Cüzdan taraması başlatılamadı. Acki network yoğun olabilir, biraz sonra tekrar dene.",
    );
  }
}

async function replyUnwatchMining(ctx: any) {
  const input = normalizeMiningInput(getCommandArgument(ctx.message?.text));
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.reply("Chat bilgisi alınamadı.");
    return;
  }

  const state = readMiningMonitorState();
  const before = state.watches.length;

  if (!input || input.toLowerCase() === "all") {
    state.watches = state.watches.filter((watch) => watch.chatId !== chatId);
    writeMiningMonitorState(state);
    await ctx.reply("Bu sohbet için tüm cüzdan tarama kayıtları durduruldu.");
    return;
  }

  const normalizedInput = input.toLowerCase();
  state.watches = state.watches.filter((watch) => {
    if (watch.chatId !== chatId) return true;
    return !(
      watch.input.toLowerCase() === normalizedInput ||
      watch.label.toLowerCase() === normalizedInput ||
      watch.address.toLowerCase() === normalizedInput ||
      watch.address.toLowerCase() === `0:${normalizedInput}`
    );
  });

  writeMiningMonitorState(state);

  if (state.watches.length === before) {
    await ctx.reply(
      "Bu wallet için aktif tarama bulunamadı. /wallets ile kontrol edebilirsin.",
    );
    return;
  }

  await ctx.reply(`Cüzdan taraması durduruldu: ${input}`);
}

async function replyWatchlist(ctx: any) {
  await replyWalletManagement(ctx);
}

async function replyWalletManagement(ctx: any) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.reply("Chat bilgisi alınamadı.");
    return;
  }

  const watches = readMiningMonitorState().watches.filter(
    (watch) => watch.chatId === chatId,
  );

  if (!watches.length) {
    await ctx.reply(
      [
        "👛 Wallet Management",
        "",
        "No wallet is being scanned yet.",
        "",
        "Add one with:",
        "/watch ackerman",
      ].join("\n"),
    );
    return;
  }

  if (watches.length === 1) {
    const onlyWatch = watches[0];

    if (onlyWatch) {
      await ctx.reply(
        buildWalletSettingsMessage(onlyWatch),
        buildWalletSettingsKeyboard(onlyWatch),
      );
    }

    return;
  }

  await ctx.reply(
    buildWalletListMessage(watches),
    buildWalletListKeyboard(watches),
  );
}

async function replyWalletManagementListFromAction(ctx: any) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.answerCbQuery("Chat bilgisi alınamadı.");
    return;
  }

  const watches = readMiningMonitorState().watches.filter(
    (watch) => watch.chatId === chatId,
  );

  await ctx.answerCbQuery();

  if (!watches.length) {
    await ctx.reply(
      [
        "👛 Wallet Management",
        "",
        "No wallet is being scanned yet.",
        "",
        "Add one with:",
        "/watch ackerman",
      ].join("\n"),
    );
    return;
  }

  await ctx.reply(
    buildWalletListMessage(watches),
    buildWalletListKeyboard(watches),
  );
}

async function replyWalletSettingsFromAction(ctx: any, key: string) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.answerCbQuery("Chat bilgisi alınamadı.");
    return;
  }

  const watch = findMiningWatchByCallbackKey(chatId, key);

  if (!watch) {
    await ctx.answerCbQuery("Wallet not found");
    await ctx.reply(
      "Bu wallet artık takip listesinde yok. /wallets ile kontrol edebilirsin.",
    );
    return;
  }

  await ctx.answerCbQuery();
  await ctx.reply(
    buildWalletSettingsMessage(watch),
    buildWalletSettingsKeyboard(watch),
  );
}

async function toggleWalletNotificationsFromAction(ctx: any, key: string) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.answerCbQuery("Chat bilgisi alınamadı.");
    return;
  }

  const state = readMiningMonitorState();
  const watch = findMiningWatchInStateByCallbackKey(state, chatId, key);

  if (!watch) {
    await ctx.answerCbQuery("Wallet not found");
    await ctx.reply(
      "Bu wallet artık takip listesinde yok. /wallets ile kontrol edebilirsin.",
    );
    return;
  }

  watch.notificationsEnabled = !isMiningWatchNotificationEnabled(watch);
  writeMiningMonitorState(state);

  await ctx.answerCbQuery(
    watch.notificationsEnabled
      ? "Notifications enabled"
      : "Notifications disabled",
  );
  await ctx.reply(
    buildWalletSettingsMessage(watch),
    buildWalletSettingsKeyboard(watch),
  );
}

async function deleteWalletFromAction(ctx: any, key: string) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.answerCbQuery("Chat bilgisi alınamadı.");
    return;
  }

  const state = readMiningMonitorState();
  const watch = findMiningWatchInStateByCallbackKey(state, chatId, key);

  if (!watch) {
    await ctx.answerCbQuery("Wallet not found");
    await ctx.reply("Bu wallet zaten takip listesinde yok.");
    return;
  }

  state.watches = state.watches.filter((item) => item.id !== watch.id);
  writeMiningMonitorState(state);

  await ctx.answerCbQuery("Wallet deleted");
  await ctx.reply(
    [
      "🗑️ Wallet deleted",
      "",
      `Wallet: ${watch.label}`,
      "Mining notifications stopped for this wallet.",
    ].join("\n"),
  );
}

async function replyMiningStatus(ctx: any) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.reply("Chat bilgisi alınamadı.");
    return;
  }

  await ctx.reply(buildMiningSummaryStatusMessage(chatId));
}

async function updateMiningWatchRecord(
  watch: MiningWatchRecord,
  bot?: Telegraf<any>,
  options: { sendNotifications?: boolean } = {},
) {
  const now = new Date().toISOString();

  try {
    const wallet = await getAckiPopitGameActivity(watch.address || watch.input);
    const lockedRaw = getLockedNacklRawForMonitor(wallet);
    const currentSourceKey = getPopitMonitorSourceKey(wallet, lockedRaw);
    const currentTransactionLt = getPopitLastTransactionLt(wallet);
    const previousSourceKey =
      watch.lastMonitorSourceKey ||
      (watch.lastTransactionLt ? `lt:${watch.lastTransactionLt}` : null);
    const previousRaw = safeBigInt(watch.lastLockedRaw);
    const currentRaw = safeBigInt(lockedRaw);
    const previousCheckedAtMs = parseIsoTimeMs(watch.lastCheckedAt);
    const staleDeltaWindowExceeded =
      previousCheckedAtMs > 0 &&
      Date.now() - previousCheckedAtMs > MINING_MONITOR_FRESH_DELTA_WINDOW_MS;
    let deltaRaw = "0";
    let changed = false;
    let baselineOnly = false;

    watch.label = wallet.name || watch.label || wallet.input || watch.input;
    watch.address = wallet.address;
    watch.popitGameAddress =
      wallet.popitGame?.address || watch.popitGameAddress || null;
    watch.lastActivityAt =
      wallet.popitGame?.lastPaid ||
      wallet.lastPaid ||
      watch.lastActivityAt ||
      null;
    watch.lastCheckedAt = now;
    watch.notificationsEnabled = watch.notificationsEnabled !== false;
    watch.lastSourceStatus = "ok";
    watch.lastSourceError = undefined;

    // Revize 9.6.28: mining notification guard is PopitGame state + locked NACKL raw.
    // Some PopitGame accounts keep lastTransactionLt unchanged while locked balanceRaw increases.
    // The composite source key prevents duplicate notifications without silently syncing real rewards.
    if (!previousSourceKey || !currentSourceKey) {
      watch.lastLockedRaw = lockedRaw;
      watch.lastTransactionLt = currentTransactionLt;
      watch.lastMonitorSourceKey = currentSourceKey;

      return {
        deltaRaw,
        lockedRaw,
        changed: false,
        notified: false,
        touched: true,
        baselineOnly: true,
        sourceKey: currentSourceKey,
      };
    }

    if (currentSourceKey === previousSourceKey) {
      watch.lastLockedRaw = lockedRaw;
      watch.lastTransactionLt =
        currentTransactionLt || watch.lastTransactionLt || null;
      watch.lastMonitorSourceKey = currentSourceKey;

      return {
        deltaRaw,
        lockedRaw,
        changed: false,
        notified: false,
        touched: true,
        baselineOnly: false,
        sourceKey: currentSourceKey,
      };
    }

    deltaRaw = (currentRaw - previousRaw).toString();
    changed = currentRaw > previousRaw;
    let notified = false;

    const shouldPreserveActiveDelta = hasRecentMiningWatchActivity(
      watch,
      Date.now(),
      Math.max(MINING_MONITOR_FAST_LANE_WINDOW_MS, 6 * 60 * 60 * 1000),
    );

    if (changed && staleDeltaWindowExceeded && !shouldPreserveActiveDelta) {
      // Revize 9.6.25/9.6.27: avoid sending old accumulated rewards as a fresh
      // mining event only for truly passive wallets. Recently active wallets can
      // be late because of provider pool timeouts, so their deltas must not be
      // silently rebased.
      watch.lastLockedRaw = lockedRaw;
      watch.lastTransactionLt = currentTransactionLt;
      watch.lastMonitorSourceKey = currentSourceKey;

      return {
        deltaRaw,
        lockedRaw,
        changed: false,
        notified: false,
        touched: true,
        baselineOnly: true,
        sourceKey: currentSourceKey,
        freshDeltaSkipped: true,
      };
    }

    if (changed) {
      watch.events.push({
        at: now,
        deltaRaw,
        totalRaw: lockedRaw,
        sourceKey: currentSourceKey,
      });
      foldMiningEvents(watch);

      const shouldNotify =
        options.sendNotifications !== false &&
        isMiningWatchNotificationEnabled(watch);

      if (bot && shouldNotify && !isChatBlocked(watch.chatId)) {
        try {
          await sendMessageWithOptionalHtml(
            bot,
            watch.chatId,
            formatDeltaNotificationMessage(deltaRaw, watch.label),
          );
          watch.lastNotifyAt = now;
          notified = true;
        } catch (error) {
          noteNotificationFailure(watch.chatId, error);
          console.error("Mining monitor notification send failed:", {
            watch: watch.label || watch.input,
            chatId: watch.chatId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else {
      baselineOnly = true;
    }

    watch.lastLockedRaw = lockedRaw;
    watch.lastTransactionLt = currentTransactionLt;
    watch.lastMonitorSourceKey = currentSourceKey;

    return {
      deltaRaw,
      lockedRaw,
      changed,
      notified,
      touched: true,
      baselineOnly,
      sourceKey: currentSourceKey,
    };
  } catch (error) {
    watch.lastCheckedAt = now;
    watch.lastSourceStatus = "unavailable";
    watch.lastSourceError = formatMonitorSourceError(error);
    throw error;
  }
}

async function replyManualMiningUpdate(ctx: any) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.reply("Chat bilgisi alınamadı.");
    return;
  }

  const state = readMiningMonitorState();
  const watches = state.watches.filter((watch) => watch.chatId === chatId);

  if (!watches.length) {
    await ctx.reply(
      "Aktif cüzdan taraması yok. Eklemek için: /info ackerman",
    );
    return;
  }

  const lines = ["🔄 Wallet balances updated", ""];
  let changed = false;

  for (const watch of watches) {
    try {
      const result = await updateMiningWatchRecord(watch, undefined, {
        sendNotifications: false,
      });
      const delta = safeBigInt(result.deltaRaw);
      const deltaText =
        delta !== 0n
          ? `${formatSignedRawNackl(result.deltaRaw)} $NACKL`
          : "no change";
      changed = changed || result.changed;
      lines.push(
        `${watch.label}: ${formatRawNackl(watch.lastLockedRaw)} $NACKL (${deltaText})`,
      );
    } catch (error) {
      lines.push(`${watch.label}: update failed`);
      console.error("Manual mining update error:", {
        watch: watch.label || watch.input,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  writeMiningMonitorState(state);

  await ctx.reply(lines.join("\n"));
}

// PopitGame addresses of the wallets this bot is actively mining, keyed the
// same way selectMiningWatchesForTick compares them (lowercased).  Matching is
// on (chatId, walletName) because a wallet name alone is not unique across
// chats, and bee-miner ids are built from exactly that pair.
function collectBeeMinedPopitAddresses(state: MiningMonitorState): Set<string> {
  const addresses = new Set<string>();

  try {
    const minedKeys = new Set(
      readBeeMinerState()
        .miners.filter((miner) => miner.status === "active")
        .map((miner) => `${miner.chatId}:${String(miner.walletName).toLowerCase()}`),
    );

    if (!minedKeys.size) {
      return addresses;
    }

    for (const watch of state.watches) {
      const popit = String(watch.popitGameAddress || "").toLowerCase();

      if (!popit) {
        continue;
      }

      const label = String(watch.label || watch.input || "").toLowerCase();

      if (minedKeys.has(`${watch.chatId}:${label}`)) {
        addresses.add(popit);
      }
    }
  } catch (error) {
    // A malformed bee-miners.json must not take the whole monitor tick down;
    // losing priority just means falling back to the ordinary rotation.
    console.warn("Bee mined popit address collection failed:", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return addresses;
}

async function runMiningMonitorTick(bot: Telegraf<any>, trigger = "auto") {
  // Bee uses the same public GraphQL pool as the broad wallet monitor.  Do
  // not flood that pool while a Bee session or reward claim is live; a missed
  // canonical epoch costs more than a delayed non-Bee wallet scan.
  if (
    beeIsChainCritical() ||
    beeSessionRunning.size ||
    beeClaimRunning.size ||
    beeSubmissionSettling.size
  ) {
    console.log("Mining monitor tick deferred: Bee chain critical section active");
    return;
  }
  if (miningMonitorRuntime.isTickRunning) {
    console.log("Mining monitor tick skipped: previous tick is still running");
    return;
  }

  miningMonitorRuntime.isTickRunning = true;
  miningMonitorRuntime.lastTickStartedAt = new Date().toISOString();
  miningMonitorRuntime.lastTickTrigger = trigger;
  miningMonitorRuntime.lastError = null;

  const state = readMiningMonitorState();
  const nowMs = Date.now();

  // Note: an earlier revision tried a cheap batch pre-check here via
  // mainnet.ackinacki.org's accounts(filter:{id:{in:[...]}}) query to avoid
  // scanning wallets that hadn't changed. That query returns "Deprecated API
  // is disabled" on this specific mainnet endpoint (the docs describing it
  // are apparently stale relative to what's actually deployed here), so it
  // was removed rather than left calling a permanently-failing endpoint every
  // tick. The real scaling win instead comes from getAckiPopitGameActivity
  // (see updateMiningWatchRecord below), which cut the per-wallet network
  // calls in this tick from 2 down to 1 by skipping the unused main-account
  // query.
  // Wallets we mine ourselves earn once per ~5.6-minute epoch, but the plain
  // rotation revisits a given wallet every ~26 min (fast lane) to ~55 min
  // (passive), so their rewards were arriving merged and hours late.  Worse,
  // a wallet whose mining stalls goes stale -> drops to the passive lane ->
  // gets scanned even less often, which is self-reinforcing.  Feed them to
  // the priority lane that selectMiningWatchesForTick already implements but
  // that nothing was passing: they bypass the cooldown and get scanned every
  // tick regardless of rotation position.
  const priorityPopitAddresses = collectBeeMinedPopitAddresses(state);
  const selection = selectMiningWatchesForTick(state, nowMs, priorityPopitAddresses);
  const scanGroups = buildMiningSourceScanGroups(selection.watches, state.watches);
  state.nextScanCursor = selection.nextCursor;
  state.nextActiveScanCursor = selection.nextActiveCursor;
  state.nextPassiveScanCursor = selection.nextPassiveCursor;

  let changed = false;
  let changedCount = 0;
  let queuedCount = 0;
  let baselineCount = 0;
  let freshSkippedCount = 0;
  let errorCount = 0;
  let rateLimited = false;
  let stoppedByBackoff = false;
  // Reverted: back to instant, tick-scoped grouping only — wallets whose
  // rewards get detected within the SAME tick are combined into one message,
  // sent right after this tick's scan finishes, with no added delay. Wallets
  // whose reward cycles land in different ticks arrive as separate messages.
  const chatRewardBatches = new Map<
    number,
    Array<{ subscriber: MiningWatchRecord; label: string; deltaRaw: string }>
  >();

  console.log("Mining monitor tick started:", {
    trigger,
    watches: state.watches.length,
    scanWatches: selection.watches.length,
    uniqueScanSources: scanGroups.length,
    skippedCooldown: selection.skippedCooldown,
    skippedBackoff: selection.skippedBackoff,
    startCursor: selection.startCursor,
    nextCursor: state.nextScanCursor,
    activeEligible: selection.activeEligible,
    passiveEligible: selection.passiveEligible,
    selectedActive: selection.selectedActive,
    selectedPassive: selection.selectedPassive,
    selectedPriority: selection.selectedPriority,
    bypassedActiveCooldown: selection.bypassedActiveCooldown,
    startActiveCursor: selection.startActiveCursor,
    nextActiveCursor: state.nextActiveScanCursor,
    startPassiveCursor: selection.startPassiveCursor,
    nextPassiveCursor: state.nextPassiveScanCursor,
    at: miningMonitorRuntime.lastTickStartedAt,
  });

  try {
    await runMiningMonitorWorkers(
      scanGroups,
      MINING_MONITOR_CONCURRENCY,
      async (group) => {
        // A monitor tick may have begun a few seconds before Bee entered a
        // session.  Stop issuing further wallet reads as soon as Bee takes
        // the shared endpoint, rather than letting the old worker queue run
        // through the rest of its 40 wallets.
        if (beeSessionRunning.size || beeClaimRunning.size || beeSubmissionSettling.size) {
          stoppedByBackoff = true;
          return;
        }
        if (rateLimited) {
          stoppedByBackoff = true;
          return;
        }

        const sourceWatch = group.baselineWatch;

        try {
          const workingWatch = cloneMiningWatchForScan(sourceWatch);
          const result = await withMiningMonitorTimeout(
            updateMiningWatchRecord(workingWatch, undefined, {
              sendNotifications: false,
            }),
            MINING_MONITOR_WALLET_TIMEOUT_MS,
            sourceWatch.label || sourceWatch.input,
          );

          for (const subscriber of group.watches) {
            syncMiningSourceScanResultToWatch(subscriber, workingWatch, result);
            markMiningWatchScanSuccess(subscriber);
          }

          changed = changed || result.changed;

          if (result.baselineOnly) {
            baselineCount += 1;
          }

          if ((result as any).freshDeltaSkipped) {
            freshSkippedCount += 1;
            console.log("Mining monitor stale delta rebased:", {
              wallet: workingWatch.label || workingWatch.input,
              subscribers: group.watches.length,
              delta: formatSignedRawNackl(result.deltaRaw),
              sourceKey: result.sourceKey,
            });
          }

          let queued = 0;
          let skippedDisabled = 0;
          let skippedAlreadySynced = 0;

          if (result.changed && safeBigInt(result.deltaRaw) > 0n) {
            changedCount += 1;

            for (const subscriber of group.watches) {
              // Nothing gets queued when notifications are globally off, so the
              // send loop below simply finds an empty map — the scan itself and
              // the state it writes are untouched.
              const shouldNotify =
                MINING_MONITOR_NOTIFY_ENABLED &&
                isMiningWatchNotificationEnabled(subscriber);

              if (!shouldNotify) {
                skippedDisabled += 1;
                continue;
              }

              if (!result.sourceKey) {
                skippedAlreadySynced += 1;
                continue;
              }

              const batch = chatRewardBatches.get(subscriber.chatId) || [];
              batch.push({
                subscriber,
                label: subscriber.label || workingWatch.label,
                deltaRaw: result.deltaRaw,
              });
              chatRewardBatches.set(subscriber.chatId, batch);
              queued += 1;
              queuedCount += 1;
            }

            console.log("Mining monitor popit transaction delta detected:", {
              wallet: workingWatch.label || workingWatch.input,
              delta: formatSignedRawNackl(result.deltaRaw),
              sourceKey: result.sourceKey,
              subscribers: group.watches.length,
              queued,
              skippedDisabled,
              skippedAlreadySynced,
            });
          }
        } catch (error) {
          errorCount += 1;
          const message =
            error instanceof Error ? error.message : String(error);
          miningMonitorRuntime.lastError = message;

          for (const subscriber of group.watches) {
            markMiningWatchScanError(subscriber, message, state);
          }

          if (isMiningRateLimitError(message)) {
            rateLimited = true;
            stoppedByBackoff = true;
          }

          console.error("Mining monitor check error:", {
            watch: sourceWatch.label || sourceWatch.input,
            subscribers: group.watches.length,
            message,
          });
        } finally {
          if (MINING_MONITOR_REQUEST_DELAY_MS > 0) {
            await sleep(MINING_MONITOR_REQUEST_DELAY_MS);
          }
        }
      },
    );

    for (const [chatId, batch] of chatRewardBatches) {
      if (isChatBlocked(chatId)) {
        continue;
      }

      try {
        await sendGroupedRewardMessage(
          bot,
          chatId,
          batch.map((entry) => ({
            label: entry.label,
            deltaRaw: entry.deltaRaw,
          })),
        );

        const now = new Date().toISOString();
        for (const entry of batch) {
          entry.subscriber.lastNotifyAt = now;
        }
      } catch (error) {
        noteNotificationFailure(chatId, error);
        console.error("Mining monitor grouped notification send failed:", {
          chatId,
          wallets: batch.length,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    mergeAndWriteMiningMonitorState(state);
  } finally {
    miningMonitorRuntime.lastTickFinishedAt = new Date().toISOString();
    miningMonitorRuntime.lastTickWatchCount = state.watches.length;
    miningMonitorRuntime.lastTickChangedCount = changedCount;
    // Sending happens synchronously within this same tick now (grouped and
    // sent right after the scan loop finishes), so queuedCount and sent
    // count are effectively the same; queuedCount is reported here.
    miningMonitorRuntime.lastTickNotifiedCount = queuedCount;
    miningMonitorRuntime.lastTickErrorCount = errorCount;
    miningMonitorRuntime.isTickRunning = false;

    console.log("Mining monitor tick finished:", {
      trigger,
      watches: state.watches.length,
      scanWatches: selection.watches.length,
      uniqueScanSources: scanGroups.length,
      changed: changedCount,
      queued: queuedCount,
      baselined: baselineCount,
      freshSkipped: freshSkippedCount,
      errors: errorCount,
      skippedCooldown: selection.skippedCooldown,
      skippedBackoff: selection.skippedBackoff,
      startCursor: selection.startCursor,
      nextCursor: state.nextScanCursor,
      activeEligible: selection.activeEligible,
      passiveEligible: selection.passiveEligible,
      selectedActive: selection.selectedActive,
      selectedPassive: selection.selectedPassive,
      selectedPriority: selection.selectedPriority,
      bypassedActiveCooldown: selection.bypassedActiveCooldown,
      startActiveCursor: selection.startActiveCursor,
      nextActiveCursor: state.nextActiveScanCursor,
      startPassiveCursor: selection.startPassiveCursor,
      nextPassiveCursor: state.nextPassiveScanCursor,
      rateLimited,
      stoppedByBackoff,
      globalBackoffUntil: state.globalBackoffUntil || null,
      at: miningMonitorRuntime.lastTickFinishedAt,
    });
  }
}

function startMiningMonitorScheduler(bot: Telegraf<any>) {
  if (miningMonitorTimer) {
    clearTimeout(miningMonitorTimer);
  }

  miningMonitorRuntime.startedAt = new Date().toISOString();

  // Revize fix: self-correcting fixed cadence. The previous version scheduled
  // the next tick MINING_MONITOR_INTERVAL_MS after the *previous tick finished*.
  // Under load (50+ wallets, frequent provider timeouts) a single tick could
  // take several minutes, and every overrun permanently added to the next
  // wait on top of that — the backlog never closed, so wallets fell further
  // and further behind epoch-over-epoch and rewards started arriving as
  // multi-epoch batches that never caught back up to real time.
  //
  // Now we track an absolute "target" timestamp per slot. If a tick overruns
  // its slot, the next slot has already passed, so we fire again almost
  // immediately (small floor to avoid a tight loop) instead of adding a full
  // interval on top of the delay. This lets the monitor catch up instead of
  // permanently drifting.
  const MIN_RESCHEDULE_FLOOR_MS = 1000;

  const scheduleAt = (targetMs: number) => {
    const delayMs = Math.max(0, targetMs - Date.now());
    miningMonitorRuntime.nextTickAt = new Date(targetMs).toISOString();
    miningMonitorTimer = setTimeout(() => {
      void runMiningMonitorTick(bot, "auto").finally(() => {
        const nextTarget = targetMs + MINING_MONITOR_INTERVAL_MS;
        scheduleAt(Math.max(nextTarget, Date.now() + MIN_RESCHEDULE_FLOOR_MS));
      });
    }, delayMs);
  };

  const scheduleNext = (delayMs: number) => {
    scheduleAt(Date.now() + delayMs);
  };

  console.log("Mining monitor scheduler started:", {
    intervalSeconds: Math.round(MINING_MONITOR_INTERVAL_MS / 1000),
    firstTickSeconds: Math.round(MINING_MONITOR_INITIAL_DELAY_MS / 1000),
    monitorSource: "popitGame.lastTransactionLt+lockedNacklRaw",
    scanMode: "active-fast-lane-rolling-queue",
    concurrency: MINING_MONITOR_CONCURRENCY,
    maxWalletsPerTick: MINING_MONITOR_MAX_WALLETS_PER_TICK,
    fastLaneMaxWalletsPerTick: MINING_MONITOR_FAST_LANE_MAX_WALLETS,
    fastLaneWindowMinutes: Math.round(
      MINING_MONITOR_FAST_LANE_WINDOW_MS / 60 / 1000,
    ),
    freshDeltaWindowMinutes: Math.round(
      MINING_MONITOR_FRESH_DELTA_WINDOW_MS / 60 / 1000,
    ),
    requestDelayMs: MINING_MONITOR_REQUEST_DELAY_MS,
    walletTimeoutMs: MINING_MONITOR_WALLET_TIMEOUT_MS,
    rateLimitBackoffSeconds: Math.round(
      MINING_MONITOR_RATE_LIMIT_BACKOFF_MS / 1000,
    ),
    passiveRecheckMinutes: Math.round(
      MINING_MONITOR_PASSIVE_RECHECK_MS / 60000,
    ),
  });

  scheduleNext(MINING_MONITOR_INITIAL_DELAY_MS);
}

// Fix: Bee Engine cloud mining. Runs an automated mining session per
// registered wallet, on the same self-correcting-cadence pattern as the
// mining monitor scheduler above (learned the hard way earlier: naive
// "wait N ms after the previous tick finished" scheduling lets delay
// compound forever under load).
const BEE_APP_ID = process.env.BEE_APP_ID || "";
const BEE_MINING_ENABLED =
  String(process.env.BEE_MINING_ENABLED || "false").toLowerCase() === "true";
const BEE_MINING_INTERVAL_MS =
  Number(process.env.BEE_MINING_INTERVAL_SECONDS || 300) * 1000; // 5 min epoch
const BEE_MINING_SESSION_DURATION_MS =
  // CappAckiMiner exposes a 120-second work window but its completed session
  // is 135 seconds long once the SDK's own finalization margin is included.
  // Use the observed 135-second lifecycle so our 70 taps match the reference.
  Number(process.env.BEE_MINING_SESSION_SECONDS || 135) * 1000;
const BEE_MINING_TAP_WINDOW_MS = Math.min(
  BEE_MINING_SESSION_DURATION_MS - 1_000,
  Number(process.env.BEE_MINING_TAP_WINDOW_SECONDS || 120) * 1000,
);
const BEE_MINING_TAP_COUNT = Number(process.env.BEE_MINING_TAP_COUNT || 70);
// Same cap the dashboard uses (server.ts). The chain's own cycle clock is
// fixed and not something this bot tracks or needs to: once tap_sum reaches
// the cap, the cycle is over regardless of wall-clock time, and it starts
// again whenever the chain resets tap_sum — observed 2026-08-07 to happen well
// before a naive "24h from cap" wait would suggest. So rather than compute a
// wait time, just watch tap_sum and resume as soon as it drops.
const BEE_CYCLE_TAP_CAP = Number(process.env.BEE_CYCLE_TAP_CAP || 12000);

// Retry only a definite root failure whose tap sum stayed unchanged. One retry
// still fits in the ~335-second canonical epoch after a 135-second first try;
// more would normally cross the boundary and risk attributing taps wrongly.
const BEE_CONGESTION_RETRIES = Number(process.env.BEE_CONGESTION_RETRIES || 1);
const BEE_CONGESTION_RETRY_DELAY_MS = Number(
  process.env.BEE_CONGESTION_RETRY_DELAY_MS || 2000,
);
const BEE_CONGESTION_READY_TIMEOUT_MS = Math.max(
  BEE_CONGESTION_RETRY_DELAY_MS,
  Number(process.env.BEE_CONGESTION_READY_TIMEOUT_SECONDS || 60) * 1000,
);
const BEE_SUBMISSION_SETTLE_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.BEE_SUBMISSION_SETTLE_TIMEOUT_SECONDS || 90) * 1000,
);
const BEE_SUBMISSION_SETTLE_POLL_MS = 1000;
// CappAckiMiner's visible defaults: a 120s work window, then a 50s
// safety-net before the next normal session.  `can_start()` can flip early
// while a proof is still being indexed, so this is deliberately separate
// from the acceptance gate above.
const BEE_SAFETY_NET_MS = Math.max(
  0,
  Number(process.env.BEE_SAFETY_NET_SECONDS || 50) * 1000,
);
const BEE_RESTART_FLOOR_MS = Math.max(
  0,
  Number(process.env.BEE_RESTART_FLOOR_SECONDS || 2) * 1000,
);
const BEE_MINING_CONCURRENCY = Math.max(
  1,
  Number(process.env.BEE_MINING_CONCURRENCY || 2),
);
const BEE_MINING_INITIAL_DELAY_MS = 20 * 1000;

// The chain's reward epoch is 5 minutes. Kept separate from
// BEE_MINING_INTERVAL_MS on purpose: that one is our own scheduling cadence and
// is configurable, this one is a property of the chain. They happen to be equal
// today, which is exactly why a drift between them is easy to miss.
const BEE_EPOCH_MS = 5 * 60 * 1000;

// Start a short mining session late enough in each epoch that its claim can
// happen just after the boundary. Starting immediately after a process
// restart made the 120-second live session finish far too early; the 45-second
// claim-wait safeguard then expired before the real boundary and forfeited
// otherwise valid work. The 30-second buffer covers miner setup and gives the
// post-boundary claim room without delaying the next epoch's session.
const BEE_SESSION_START_OFFSET_MS = Math.max(
  0,
  BEE_EPOCH_MS - BEE_MINING_SESSION_DURATION_MS - 30_000,
);

// Experiment (2026-08-07): ~23% of epochs are never paid, at a rate that is flat
// across a whole cycle, so it is not budget taper and not scheduler drift — both
// were measured and ruled out. The session ends ~271s into a 300s epoch and we
// claim immediately, i.e. ~28s BEFORE the epoch closes. If an epoch's reward is
// only finalized at its boundary, an early claim would come up empty and that
// epoch's reward would be lost. Holding the claim until just past the boundary
// tests that directly. Env-tunable so it can be turned off without a deploy.
const BEE_CLAIM_AFTER_EPOCH =
  String(process.env.BEE_CLAIM_AFTER_EPOCH || "true").toLowerCase() === "true";
const BEE_CLAIM_EPOCH_DELAY_MS = Number(
  process.env.BEE_CLAIM_EPOCH_DELAY_MS || 3000,
);
// Never let the wait push the tick into the next scheduled run.
const BEE_CLAIM_MAX_WAIT_MS = 45 * 1000;

// How long to wait before concluding a session's taps never reached the chain.
//
// This used to be a ~540s ladder (90+240+210), sized from the TVM SDK's own
// documented message retry ceiling (~8.8 min: 40s expiry growing 1.5x over 5
// retries). That reasoning was right about the SDK but wrong about the cost.
// The confirmation holds this wallet's serialization lock, so a 9-minute ladder
// after a lost session skipped TWO further 5-minute ticks — measured 2026-08-08:
// a loss at 06:36 produced no further session until 06:51. At a ~14% loss rate
// that is ~0.28 extra epochs forfeited per session, i.e. the waiting cost more
// throughput than the losses themselves.
//
// Against that: across 90 measured sessions, ZERO were ever rescued by a later
// stage (`gec-onaylanan: 0`) — a confirmation either lands in the first ~90s or
// not at all. A reference miner's logs put genuine late accepts at 10/3600
// (~0.3%), so giving them up is a rounding error next to a 28% throughput gain.
//
// Budget is therefore derived, not hardcoded: the whole ladder must finish
// before the next tick so no tick is ever skipped by waiting.
const BEE_TAP_CONFIRM_BUDGET_MS = Math.max(
  60_000,
  BEE_MINING_INTERVAL_MS - BEE_MINING_SESSION_DURATION_MS - 40_000,
);
const BEE_TAP_CONFIRM_STAGE_DELAYS_MS = (() => {
  const first = Math.min(90_000, BEE_TAP_CONFIRM_BUDGET_MS);
  const second = BEE_TAP_CONFIRM_BUDGET_MS - first;
  // Only add a second look if it buys a meaningful extra window.
  return second >= 30_000 ? [first, second] : [first];
})();
const BEE_TAP_CONFIRM_FINAL_STAGE = BEE_TAP_CONFIRM_STAGE_DELAYS_MS.length;

let beeMiningTimer: ReturnType<typeof setTimeout> | undefined;
let beeMiningTickRunning = false;

// Where each miner's event buffer stood at the end of its last session, so the
// next one can read exactly the events that arrived in between.
const beeLastEventIndex = new Map<string, number>();

// Found by reading the on-chain Miner contract (contracts/mvsystem/Miner.sol):
// `_commitData` / `_commitInterval` are ONE slot per contract, not per session.
// `acceptTap` requires `_commitData.hasValue()`. The wasm SDK's `start()` only
// blocks on workers still `Computing`, not ones already `Submitting` — so if a
// session's on-chain acceptance is still pending when the next tick fires, we
// were starting a second session that calls setCommitData again and overwrites
// the first one's slot. The first session's delayed acceptTap then finds stale
// or missing commit data and is rejected — a plausible mechanism for the
// ~20-30% loss rate that survived every earlier client-side mitigation (none
// of them addressed this, because the race is on-chain, not in our process).
// Fix: don't start a new session for a wallet while its previous one hasn't
// been confirmed settled (landed or definitively lost) yet.
// Stores the timestamp the lock was taken, not just a flag, so it can expire.
// A pure boolean deadlocked mining outright on 2026-08-09: a session start
// offset was added upstream (session begins ~150s into the epoch) which pushed
// session end + confirmation ladder past the next tick, so the lock was never
// released before the next tick checked it and EVERY tick skipped — mining sat
// idle for over an hour reporting "succeeded". A lock whose release depends on
// timers finishing inside one interval must not be able to outlive that
// interval; anything older is stale by definition and gets reclaimed.
const beeSessionInFlight = new Map<string, number>();

// Generous: covers one full tick plus the confirmation ladder that trails it.
// Only exists to break a deadlock, never to permit a genuine overlap.
const BEE_SESSION_LOCK_MAX_MS = BEE_MINING_INTERVAL_MS * 2;

// A busy chain must not permanently disable a miner. Only "active" miners are
// picked up by the tick, so flipping to "error" on a transient QUEUE_OVERFLOW /
// pool timeout meant one bad moment silently retired the miner until someone
// re-ran /miner_connect. Stay active on transient faults and let the next tick
// retry.
function isTransientMiningFault(message: string): boolean {
  return /QUEUE_OVERFLOW|queue is full|pool timed out|timed out|timeout|WORKERS_NOT_READY|Cancel stale session/i.test(
    message,
  );
}

async function runBeeMiningTick() {
  if (beeMiningTickRunning) {
    console.log("Bee mining tick skipped: previous tick still running");
    return;
  }

  if (!BEE_APP_ID) {
    console.log("Bee mining tick skipped: BEE_APP_ID not configured");
    return;
  }

  beeMiningTickRunning = true;

  try {
    const state = readBeeMinerState();
    const paymentsState = readPaymentsState();
    const now = Date.now();
    const activeMiners = state.miners.filter(
      (miner) =>
        miner.status === "active" &&
        (isAdminChatId(miner.chatId) ||
          hasActiveSubscriptionForChat(paymentsState, miner.chatId, now)),
    );
    const unpaidActiveCount = state.miners.filter(
      (miner) =>
        miner.status === "active" &&
        !isAdminChatId(miner.chatId) &&
        !hasActiveSubscriptionForChat(paymentsState, miner.chatId, now),
    ).length;
    const adminMiningCount = activeMiners.filter((miner) =>
      isAdminChatId(miner.chatId),
    ).length;

    if (adminMiningCount) {
      console.log("Bee mining admin test bypass active:", { count: adminMiningCount });
    }

    if (unpaidActiveCount) {
      console.warn("Bee mining skipped for miners without an active subscription:", {
        count: unpaidActiveCount,
      });
    }

    if (!activeMiners.length) {
      return;
    }

    console.log("Bee mining tick started:", { activeMiners: activeMiners.length });

    let index = 0;
    let succeeded = 0;
    let failed = 0;

    const worker = async () => {
      while (index < activeMiners.length) {
        // The loop guard proves this item exists; spell that out for the
        // compiler as indexed access is intentionally checked project-wide.
        const current = activeMiners[index]!;
        index += 1;
        // True once checkTapLanding's async timer has been scheduled: past
        // that point ONLY it may clear beeSessionInFlight, never the
        // synchronous catch below — result.error still throws synchronously
        // after scheduling it, and the outer catch must not race the
        // deferred check by clearing the flag early.
        let deferredCheckScheduled = false;
        // Declared outside the try so the catch block (a different lexical
        // block) can also reach it — assigned inside the try right after the
        // null check, may remain null if that check itself threw.
        let minerAddress: string | null = null;

        try {
          if (!current.minerAddress) {
            throw new Error("MINER_ADDRESS_MISSING");
          }

          // Keyed by minerAddress, not by our own record id. Read
          // contracts/mvsystem/Miner.sol: `_commitData`/`_commitInterval` are
          // ONE global slot per on-chain Miner contract, not per caller. Two
          // different local BeeMinerRecord entries (e.g. the same wallet name
          // connected once via the bot and once via the dashboard, which
          // today produces two records with different chatId/id but the same
          // resolved minerAddress) would otherwise be serialized against
          // themselves but still race each other on that shared slot if both
          // were ever "active" at once. Keying by the on-chain address closes
          // that regardless of how many local records point at it.
          minerAddress = current.minerAddress;

          const lockedAt = beeSessionInFlight.get(minerAddress);

          if (lockedAt != null) {
            const heldMs = Date.now() - lockedAt;

            if (heldMs < BEE_SESSION_LOCK_MAX_MS) {
              console.log("Bee session skipped: previous session still settling on-chain:", {
                walletName: current.walletName,
                heldSeconds: Math.round(heldMs / 1000),
              });
              continue;
            }

            // Past the ceiling the release path is demonstrably not coming —
            // keep mining rather than idling forever waiting on it.
            console.warn("Bee session lock expired, reclaiming:", {
              walletName: current.walletName,
              heldSeconds: Math.round(heldMs / 1000),
            });
            beeSessionInFlight.delete(minerAddress);
          }

          // Measured 2026-08-07: tap_sum hit the 12,000 cap and stayed pinned
          // there for ~75 minutes across ~15 sessions, every one reporting
          // confirmedDelta: 0 and getting its instance discarded for no
          // reason — a fresh instance also gets 0 once the chain has closed
          // the cycle. Once capped, skip the full session and just take a
          // cheap chain read to detect the reset, so the tick stops wasting
          // sessions and stops discarding perfectly good instances until
          // there is actually a new cycle to mine.
          if (
            current.lastTapSum != null &&
            current.lastTapSum >= BEE_CYCLE_TAP_CAP
          ) {
            const probeHandle = await beeAcquireMiner({
              appId: current.appId,
              minerAddress: current.minerAddress,
              publicKey: current.publicKey,
              secretKey: current.secretKey,
            });
            const probe = await beeReadMinerData(probeHandle);

            if (probe && probe.tapSum < BEE_CYCLE_TAP_CAP) {
              console.log("Bee cycle reset detected, resuming mining:", {
                walletName: current.walletName,
                previousTapSum: current.lastTapSum,
                newTapSum: probe.tapSum,
              });
              current.lastTapSum = probe.tapSum;
              current.lastTapSumAt = new Date().toISOString();
            } else {
              current.lastTapSum = probe?.tapSum ?? current.lastTapSum;
              current.lastTapSumAt = new Date().toISOString();
              succeeded += 1; // Waiting out a capped cycle is not a failure.
              continue;
            }
          }

          // Instrumentation: only the session's *completion* time was ever
          // recorded, which made it impossible to attribute a reward to the
          // session that earned it. Measured 2026-08-07: 21 sessions produced
          // only 18 rewards, and the gaps were always whole multiples of the
          // 5-minute epoch — so we are missing entire epochs rather than being
          // paid late. The suspicion is that this tick free-runs on a 300s timer
          // instead of tracking epoch boundaries, so an overrunning session lets
          // two sessions land in one epoch and leaves the next one empty.
          // epochSlot makes that visible directly: two sessions sharing a slot,
          // or a slot with none, is the bug reproducing in the log.
          beeSessionInFlight.set(minerAddress, Date.now());
          const startedAt = new Date();
          const startSlot = Math.floor(startedAt.getTime() / BEE_EPOCH_MS);

          // Reuse the miner across sessions (the reference dApp's pattern)
          // instead of building a throwaway one per tick.
          const handle = await beeAcquireMiner({
            appId: current.appId,
            minerAddress: current.minerAddress,
            publicKey: current.publicKey,
            secretKey: current.secretKey,
          });

          // Whatever the previous session's submission emitted after we
          // stopped watching it. This is the only place the real outcome of a
          // submission becomes visible.
          const lateEvents = beeTakeLateEvents(
            handle,
            beeLastEventIndex.get(current.id) ?? 0,
          );

          if (lateEvents.length) {
            const lateSummary = beeSummarizeMinerEvents(lateEvents);

            console.log("Bee late submission events:", {
              walletName: current.walletName,
              previousSessionStartedAt: current.lastSessionStartedAt,
              count: lateSummary.count,
              actions: lateSummary.actions,
              sawSubmitProof: lateSummary.sawSubmitProof,
              errors: lateSummary.errors.slice(0, 3),
            });
          }

          const dataBefore = await beeReadMinerData(handle);
          const tappingFrom = new Date();

          // Congestion retry, copied from a reference miner's own logs
          // (CappAckiMiner/goblingames, 3600 sessions): when
          // `submit_session_root` fails it re-runs the WHOLE session — start,
          // taps, stop — against the SAME Miner instance, "Congestion retry
          // 1/3 in 1s (same Miner)". Its counters prove the shape: 3385
          // logical sessions but 3600 physical Miner.start() calls, a
          // difference of 215 against 216 logged congestion retries. It
          // recovered 216 of its 225 root failures that way. We were instead
          // giving up and waiting out the whole 5-minute tick, losing the
          // epoch outright.
          //
          // Deliberately does NOT discard the miner between attempts — the
          // reference explicitly reuses the same instance, and the seed it
          // consumed is returned by the worker on a failed submit.
          let result = await beeRunMiningSession(handle, {
            durationMs: BEE_MINING_SESSION_DURATION_MS,
            tapCount: BEE_MINING_TAP_COUNT,
          });

          let congestionRetries = 0;

          while (
            congestionRetries < BEE_CONGESTION_RETRIES &&
            result.submitSummary.errors.some((e: string) =>
              /submit session root failed/i.test(e),
            ) &&
            // Only if a full further session still fits inside this tick's
            // own slot, with margin for the claim afterwards. Overrunning
            // would make the next tick skip anyway, costing more than it saves.
            Date.now() + BEE_MINING_SESSION_DURATION_MS + 30000 <
              startedAt.getTime() + BEE_MINING_INTERVAL_MS
          ) {
            congestionRetries += 1;

            console.warn("Bee congestion retry (same miner):", {
              walletName: current.walletName,
              attempt: `${congestionRetries}/${BEE_CONGESTION_RETRIES}`,
              afterMs: BEE_CONGESTION_RETRY_DELAY_MS,
            });

            await new Promise((resolve) =>
              setTimeout(resolve, BEE_CONGESTION_RETRY_DELAY_MS),
            );

            result = await beeRunMiningSession(handle, {
              durationMs: BEE_MINING_SESSION_DURATION_MS,
              tapCount: BEE_MINING_TAP_COUNT,
            });
          }

          const endedAt = new Date();
          const dataAfter = await beeReadMinerData(handle);

          console.log("Bee session timing:", {
            walletName: current.walletName,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            startSlot,
            endSlot: Math.floor(endedAt.getTime() / BEE_EPOCH_MS),
            setupMs: tappingFrom.getTime() - startedAt.getTime(),
            sessionMs: endedAt.getTime() - tappingFrom.getTime(),
            totalMs: endedAt.getTime() - startedAt.getTime(),
            taps: result.taps,
            // The decisive number: tapDelta should equal `taps` if the work
            // reached the chain. A session that earns nothing but still shows
            // +70 here means the taps landed and the claim path lost the
            // reward; no increase means the session itself never registered.
            tapSumBefore: dataBefore?.tapSum ?? null,
            tapSumAfter: dataAfter?.tapSum ?? null,
            tapDelta:
              dataBefore && dataAfter ? dataAfter.tapSum - dataBefore.tapSum : null,
            error: result.error,
            // stop() is synchronous and its submission finishes off-thread, so
            // a failed submission never throws — it can only show up here.
            stopError: result.stopError,
            eventsBeforeStop: result.eventsBeforeStop,
            eventsAfterStop: result.eventsAfterStop,
            // Submission is two-phase; `sawSubmitProof` is the one that says
            // the work was actually handed over.
            sawSubmitRoot: result.submitSummary.sawSubmitRoot,
            sawSubmitProof: result.submitSummary.sawSubmitProof,
            submitWaitedMs: result.submitWaitedMs,
            eventErrors: result.submitSummary.errors.slice(0, 3),
            postStopEvents: JSON.stringify(result.postStopEvents).slice(0, 600),
          });

          beeLastEventIndex.set(current.id, result.eventIndexAtReturn);

          // The SDK reported an error on this instance; the reference dApp
          // treats that as "crashed — re-init to recover", so do not keep
          // reusing it.
          if (result.submitSummary.errors.length) {
            beeDiscardMiner({
              appId: current.appId,
              minerAddress: current.minerAddress,
              publicKey: current.publicKey,
            });
            beeLastEventIndex.delete(current.id);

            console.error("Bee miner reported an error, instance discarded:", {
              walletName: current.walletName,
              errors: result.submitSummary.errors.slice(0, 3),
            });
          }

          // The read above is taken before the chain has confirmed, so it always
          // shows +0 and proves nothing. Re-read once the submission has had
          // time to land. Deliberately not awaited: this must not delay the
          // claim or push the tick past its next slot.
          //
          // Multi-stage check, not a fixed single wait. A third-party
          // multi-wallet Acki Nacki miner (CappAckiMiner) hit this exact
          // ambiguity and its own v0.2.1 changelog says the fix was "sessions
          // no longer receive a premature result before the network response
          // is definitive" — confirmed by the SDK's own documented behavior
          // (see BEE_TAP_CONFIRM_STAGE_DELAYS_MS above): a message can
          // legitimately still be retrying internally for up to ~9 minutes.
          // Only the final stage's zero counts as definitive; every earlier
          // stage that's still ambiguous just waits longer instead of giving
          // up, mirroring their WAITING (normal) vs RECOVERING (rebuild) split.
          const tapSumAtSession = dataBefore?.tapSum ?? null;

          // `const` capture so the closure below keeps the narrowed non-null
          // type; the outer `let minerAddress` widens back to `string | null`
          // inside a closure since TS can't prove it won't be reassigned.
          const minerAddressForFlight = minerAddress;

          const checkTapLanding = (stage: number) => {
            const delay = BEE_TAP_CONFIRM_STAGE_DELAYS_MS[stage - 1];

            setTimeout(() => {
              void (async () => {
                try {
                  const confirmed = await beeReadMinerData(handle);

                  const confirmedDelta =
                    confirmed && tapSumAtSession !== null
                      ? confirmed.tapSum - tapSumAtSession
                      : null;

                  console.log("Bee tap confirmation:", {
                    walletName: current.walletName,
                    sessionStartedAt: startedAt.toISOString(),
                    stage,
                    tapSumAtSession,
                    tapSumConfirmed: confirmed?.tapSum ?? null,
                    confirmedDelta,
                    tapsSent: result.taps,
                  });

                  // Cache the confirmed on-chain count for the dashboard.
                  // Written straight to the state file because the tick that
                  // owned this record finished long before this timer fired.
                  if (confirmed) {
                    const latest = readBeeMinerState();
                    const row = latest.miners.find((m) => m.id === current.id);

                    if (row) {
                      row.lastTapSum = confirmed.tapSum;
                      row.lastTapSumAt = new Date().toISOString();
                      writeBeeMinerState(latest);
                    }
                  }

                  if (confirmedDelta === 0 && result.taps > 0) {
                    if (stage < BEE_TAP_CONFIRM_FINAL_STAGE) {
                      // Still ambiguous — this is CappAckiMiner's WAITING
                      // state, not a confirmed loss. Give it more time. Do
                      // NOT clear the in-flight flag yet: this wallet's next
                      // session must still wait, since the on-chain commit
                      // slot may still be occupied by this one.
                      checkTapLanding(stage + 1);
                      return;
                    }

                    // Final stage still zero: the SDK's own ~9-minute retry
                    // ladder has had time to run its course. Genuinely stuck,
                    // not just slow — this mirrors their RECOVERING step.
                    beeDiscardMiner({
                      appId: current.appId,
                      minerAddress: current.minerAddress as string,
                      publicKey: current.publicKey,
                    });
                    beeLastEventIndex.delete(current.id);

                    console.warn("Bee taps never landed, miner discarded:", {
                      walletName: current.walletName,
                      sessionStartedAt: startedAt.toISOString(),
                      tapsSent: result.taps,
                    });
                  } else if (confirmedDelta !== null && confirmedDelta > 0 && stage > 1) {
                    console.log("Bee tap landed on a later check (was just slow):", {
                      walletName: current.walletName,
                      sessionStartedAt: startedAt.toISOString(),
                      stage,
                      confirmedDelta,
                    });
                  }

                  // Terminal outcome reached (landed, definitively lost, or an
                  // inconclusive read we are not going to keep chasing) — the
                  // wallet's next tick may now start a new session without
                  // racing this one's on-chain commit.
                  beeSessionInFlight.delete(minerAddressForFlight);
                } catch {
                  // A diagnostic must never break a tick. Still terminal: an
                  // unreadable chain state must not permanently stall mining.
                  beeSessionInFlight.delete(minerAddressForFlight);
                }
              })();
            }, delay);
          };

          // A failed root submission means nothing is pending on-chain, so
          // there is nothing to wait for. From bee_miner's worker.rs: when
          // `submit_session_root` errors it emits the failure event, calls
          // shutdown_worker and returns — the setCommitData that would occupy
          // Miner.sol's single `_commitData` slot never took effect. Holding
          // the serialization lock through the full ~9-minute confirmation
          // ladder in that case just delays recovery by a whole tick for no
          // benefit (observed 2026-08-08: retries dropped to one per ~10 min).
          // Note both success and failure emit action `submit_session_root`,
          // so `sawSubmitRoot` cannot distinguish them — the error list can.
          const rootSubmitFailed = result.submitSummary.errors.some((e: string) =>
            /submit session root failed/i.test(e),
          );

          if (result.taps > 0 && !rootSubmitFailed) {
            checkTapLanding(1);
            deferredCheckScheduled = true;
          } else {
            // Nothing is pending on-chain — either no tap was ever sent
            // (MINER_CANNOT_START, MINER_WORKERS_NOT_READY, start() threw)
            // or the root submission itself failed (see above). Either way
            // there is no commit slot to wait on, so release immediately and
            // let the normal 5-minute tick cadence retry rather than holding
            // the wallet for the full confirmation ladder.
            beeSessionInFlight.delete(minerAddressForFlight);
          }

          current.lastSessionStartedAt = startedAt.toISOString();

          if (result.error) {
            throw new Error(result.error);
          }

          // The taps are already on chain by this point, so the session and the
          // claim are two separate outcomes. Letting a failed get_reward throw
          // meant lastSessionAt / lastTapsSent were never written even though
          // the work really landed, which made the stored state lie about what
          // the miner had done. Record the session first, then claim.
          current.lastSessionAt = new Date().toISOString();
          current.lastTapsSent = result.taps;
          current.lastError = null;

          let claimWaitedMs = 0;

          if (BEE_CLAIM_AFTER_EPOCH) {
            const boundary =
              (Math.floor(Date.now() / BEE_EPOCH_MS) + 1) * BEE_EPOCH_MS;
            const wait = Math.min(
              Math.max(0, boundary - Date.now() + BEE_CLAIM_EPOCH_DELAY_MS),
              BEE_CLAIM_MAX_WAIT_MS,
            );

            if (wait > 0) {
              claimWaitedMs = wait;
              await new Promise((resolve) => setTimeout(resolve, wait));
            }
          }

          try {
            await beeCollectReward(handle);

            // A successful reward collection is the chain's terminal proof
            // that this session has been accepted. Keeping the serialization
            // lock until the diagnostic tap-confirmation timer fires (up to
            // 90s later) can make the next 5-minute slot skip even though it
            // is safe to start. Release only on this success path; a failed
            // or queued claim still retains the existing settlement guard.
            beeSessionInFlight.delete(minerAddressForFlight);

            const claimedAt = new Date();
            current.lastRewardAt = claimedAt.toISOString();
            succeeded += 1;

            console.log("Bee reward claimed:", {
              walletName: current.walletName,
              claimedAt: claimedAt.toISOString(),
              claimSlot: Math.floor(claimedAt.getTime() / BEE_EPOCH_MS),
              startSlot,
              slotsSpanned:
                Math.floor(claimedAt.getTime() / BEE_EPOCH_MS) - startSlot,
              taps: result.taps,
              claimWaitedMs,
            });
          } catch (rewardError) {
            const rewardMessage =
              rewardError instanceof Error
                ? rewardError.message
                : String(rewardError);
            const transient = isTransientMiningFault(rewardMessage);

            current.status = transient ? "active" : "error";
            current.lastError = `REWARD_CLAIM_FAILED: ${rewardMessage}`;
            failed += 1;

            console.error("Bee reward claim failed (session did run):", {
              walletName: current.walletName,
              chatId: current.chatId,
              taps: result.taps,
              transient,
              message: rewardMessage,
            });
          }
        } catch (error) {
          // Only clear here if the deferred check was never scheduled — once
          // it has been, it alone owns clearing this flag (see the comment
          // where deferredCheckScheduled is declared). `minerAddressForFlight`
          // is scoped inside the try block and not reachable here; use the
          // outer `let minerAddress`, guarding for the case the null-check
          // itself is what threw (never assigned).
          if (!deferredCheckScheduled && minerAddress) {
            beeSessionInFlight.delete(minerAddress);
          }

          const message = error instanceof Error ? error.message : String(error);
          const transient = isTransientMiningFault(message);

          current.status = transient ? "active" : "error";
          current.lastError = message;
          failed += 1;

          console.error("Bee mining session failed:", {
            walletName: current.walletName,
            chatId: current.chatId,
            transient,
            message,
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(BEE_MINING_CONCURRENCY, activeMiners.length) }, worker),
    );

    writeBeeMinerState(state);

    console.log("Bee mining tick finished:", { succeeded, failed });
  } finally {
    beeMiningTickRunning = false;
  }
}

// The desktop reference miner does not decide that an epoch is usable from a
// clock.  It keeps one Miner instance alive and starts again only when the SDK
// says `can_start()`.  A separate reset watcher claims after the chain has
// advanced.  Keeping those two responsibilities independent is important:
// get_reward may need retries, but it must never keep the next session from
// starting once the previous submission has settled.
const BEE_ENGINE_PULSE_MS = Math.max(
  500,
  Number(process.env.BEE_ENGINE_PULSE_MS || 1000),
);
// A real epoch is 1000 blocks ≈ 335s at the measured ~2.98 blocks/s. Anything
// stale well past that means the contract's stored epoch is frozen because
// nothing is touching it — not that the chain stopped. 15 minutes is roughly
// three epochs: long enough never to fire during healthy mining, short enough
// to recover quickly from a stall.
const BEE_EPOCH_STALE_MAX_MS = Math.max(
  60_000,
  Number(process.env.BEE_EPOCH_STALE_MAX_SECONDS || 900) * 1000,
);
const BEE_RESET_POLL_MS = Math.max(
  5_000,
  Number(process.env.BEE_RESET_POLL_SECONDS || 10) * 1000,
);
const BEE_RESET_CLAIM_DELAY_MS = Math.max(
  0,
  // The reward belongs to the epoch that has just closed.  Claim it as soon
  // as the next epoch is observed, not a further 30 seconds later.
  Number(process.env.BEE_RESET_CLAIM_DELAY_SECONDS || 0) * 1000,
);
const BEE_EPOCH_RECOVERY_DELAY_MS = Math.max(
  0,
  Number(process.env.BEE_EPOCH_RECOVERY_DELAY_SECONDS || 30) * 1000,
);

let beeAutopilotPulseRunning = false;
const beeSessionRunning = new Set<string>();
const beeClaimRunning = new Set<string>();
const beeSubmissionSettling = new Set<string>();
const beeLastResetPollAt = new Map<string, number>();
const beeObservedEpoch5m = new Map<string, string>();
const beeEpochCandidate = new Map<string, { value: string; confirmations: number }>();
// A confirmed epoch change is processed only after the previous session has
// completely left the SDK.  This prevents a reset read from racing a root
// submission and gives each canonical epoch exactly one refresh/claim path.
const beePendingEpochRefresh = new Map<string, string>();
const beeClaimRetryUntil = new Map<string, number>();
// One logical session is permitted per canonical chain epoch.  This is kept
// in memory because the chain's tap sum is authoritative after a restart.
const beeSessionEpoch5m = new Map<string, string>();
const beeEpochRecoveryUntil = new Map<string, number>();
const beePendingEpochClaims = new Map<
  string,
  { epoch5mStart: string; timer: ReturnType<typeof setTimeout> }
>();

function beeMinerKey(miner: BeeMinerRecord): string {
  return miner.minerAddress || miner.id;
}

function updateBeeMinerRecord(
  minerId: string,
  update: (miner: BeeMinerRecord) => void,
): BeeMinerRecord | null {
  const state = readBeeMinerState();
  const miner = state.miners.find((item) => item.id === minerId);

  if (!miner) {
    return null;
  }

  update(miner);
  writeBeeMinerState(state);
  return miner;
}

// A plan covers ONE mining wallet. Without the last check a subscriber could
// connect several wallets and mine them all on a single subscription, which is
// the whole price of the product given away.
//
// When a chat somehow ends up with more than one active wallet, the oldest one
// mines. Deterministic on purpose — picking "the first in the array" would
// change with file ordering and quietly move mining between wallets across
// restarts. Admins are exempt so the operator can run test wallets.
function isBeeMinerEligible(
  miner: BeeMinerRecord,
  paymentsState: ReturnType<typeof readPaymentsState>,
  now: number,
  allMiners: BeeMinerRecord[],
): boolean {
  if (miner.status !== "active") {
    return false;
  }

  if (isAdminChatId(miner.chatId)) {
    return true;
  }

  if (!hasActiveSubscriptionForChat(paymentsState, miner.chatId, now)) {
    return false;
  }

  const primary = allMiners
    .filter((m) => m.chatId === miner.chatId && m.status === "active")
    .sort(
      (a, b) =>
        (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0),
    )[0];

  return !primary || primary.id === miner.id;
}

// How many wallets a chat is already mining with — used to refuse a second one
// at the moment it is started, instead of silently ignoring it later.
function countActiveMinersForChat(
  miners: BeeMinerRecord[],
  chatId: number,
): number {
  return miners.filter((m) => m.chatId === chatId && m.status === "active")
    .length;
}

function isRootSubmitFailure(errors: string[]): boolean {
  return errors.some((error) => /submit session root failed/i.test(error));
}

function queueBeeEpochClaim(
  miner: BeeMinerRecord,
  epoch5mStart: string,
): void {
  const key = beeMinerKey(miner);
  const pending = beePendingEpochClaims.get(key);

  if (pending?.epoch5mStart === epoch5mStart || beeClaimRunning.has(key)) {
    return;
  }
  const retryRemainingMs = (beeClaimRetryUntil.get(key) ?? 0) - Date.now();
  if (retryRemainingMs > 0) {
    setTimeout(
      () => queueBeeEpochClaim(miner, epoch5mStart),
      retryRemainingMs + 250,
    );
    return;
  }

  if (pending) {
    clearTimeout(pending.timer);
  }

  const timer = setTimeout(() => {
    void (async () => {
      beePendingEpochClaims.delete(key);
      beeClaimRunning.add(key);
      beeEnterChainCritical();

      try {
        const state = readBeeMinerState();
        const fresh = state.miners.find((item) => item.id === miner.id);
        const paymentsState = readPaymentsState();

        if (
          !fresh ||
          !fresh.minerAddress ||
          !isBeeMinerEligible(
            fresh,
            paymentsState,
            Date.now(),
            readBeeMinerState().miners,
          )
        ) {
          return;
        }

        if (fresh.lastClaimedEpoch5mStart === epoch5mStart) {
          return;
        }

        const handle = await beeAcquireMiner({
          appId: fresh.appId,
          minerAddress: fresh.minerAddress,
          publicKey: fresh.publicKey,
          secretKey: fresh.secretKey,
        });

        console.log("Bee reset claim started:", {
          walletName: fresh.walletName,
          epoch5mStart,
        });
        await beeCollectReward(handle);

        updateBeeMinerRecord(fresh.id, (row) => {
          row.lastClaimedEpoch5mStart = epoch5mStart;
          row.lastClaimSubmittedAt = new Date().toISOString();
          row.lastError = null;
        });
        beeClaimRetryUntil.delete(key);
        console.log("Bee reset claim collected:", {
          walletName: fresh.walletName,
          epoch5mStart,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Bee reset claim failed:", {
          walletName: miner.walletName,
          epoch5mStart,
          message,
        });

        // The public endpoint can reject one request while the epoch is still
        // propagating.  Retry this *same* canonical epoch after the reference
        // miner's recovery pause; do not start another mining session instead.
        updateBeeMinerRecord(miner.id, (row) => {
          row.lastError = `REWARD_CLAIM_FAILED: ${message}`;
        });
        beeClaimRetryUntil.set(key, Date.now() + BEE_EPOCH_RECOVERY_DELAY_MS);
        setTimeout(
          () => queueBeeEpochClaim(miner, epoch5mStart),
          BEE_EPOCH_RECOVERY_DELAY_MS + 250,
        );
      } finally {
        beeLeaveChainCritical();
        beeClaimRunning.delete(key);
      }
    })();
  }, BEE_RESET_CLAIM_DELAY_MS);

  beePendingEpochClaims.set(key, { epoch5mStart, timer });
  console.log("Bee epoch reset observed; claim queued while mining continues:", {
    walletName: miner.walletName,
    epoch5mStart,
    claimDelaySeconds: Math.round(BEE_RESET_CLAIM_DELAY_MS / 1000),
  });
}

// The epoch boundary read straight off the chain's own clock: block height
// rounded down to the 1000-block period (MinerRewardPeriod in Miner.sol).
//
// This is the field that must drive scheduling — NOT get_miner_data()'s
// `epoch_5m_start`, which is a value STORED in the contract and only advanced
// inside _updateEpoch during acceptTap/getReward. That stored field freezes
// whenever mining stops, so gating "start a session when the epoch changes" on
// it deadlocks: no session -> contract untouched -> epoch never moves -> no
// session. Observed 2026-08-09: mining idle ~100 minutes with the stored epoch
// stuck at 77269000 while the chain had advanced 16,000+ blocks.
//
// A reference miner's logs ("block epoch candidate 77264000 awaiting
// confirmation; canonical=77263000" / "confirmed by matching block
// observations") show it uses exactly this block-derived value, which is why
// it never stalls. Verified against our own measurements: its epoch
// transitions land 340s apart, matching the ~2.98 blocks/s we measured.
const BEE_EPOCH_BLOCK_PERIOD = 1000;
const ACKI_MAINNET_GRAPHQL_URL =
  process.env.ACKI_MAINNET_GRAPHQL_URL || "https://mainnet.ackinacki.org/graphql";

// Measured on mainnet 2026-08-10 against the chain's own clock: 54 blocks in
// 18s = 3.000 blocks/s, matching the 2.98 measured on 2026-08-08.
const BEE_BLOCKS_PER_SECOND = 3.0;
// How stale an anchor may get before it is refreshed. Rate error is well under
// 0.05 blocks/s, so a minute of drift is ~3 blocks against a 1000-block epoch.
const BEE_BLOCK_ANCHOR_MAX_AGE_S = 60;
// Beyond this the guess stops being worth making.
const BEE_BLOCK_ANCHOR_HARD_LIMIT_S = 600;

// Retry spacing for the expensive height read. Without this the anchor going
// stale puts every single pulse back on the ~5s query, which is the behaviour
// this whole change exists to remove.
const BEE_BLOCK_ANCHOR_RETRY_S = 30;

let beeBlockAnchor: { seqNo: number; chainTs: number } | null = null;
let beeBlockAnchorAttemptTs = 0;

function updateChainEpochClock(
  seqNo: number,
  chainTs: number,
  source: ChainEpochClock["source"],
): string {
  const currentSeqNo = Math.floor(seqNo);
  const epochStartNumber =
    Math.floor(currentSeqNo / BEE_EPOCH_BLOCK_PERIOD) * BEE_EPOCH_BLOCK_PERIOD;
  const nextEpochSeqNo = epochStartNumber + BEE_EPOCH_BLOCK_PERIOD;
  const remainingSeconds = Math.max(
    0,
    Math.ceil((nextEpochSeqNo - currentSeqNo) / BEE_BLOCKS_PER_SECOND),
  );

  setChainEpochClock({
    epochStart: String(epochStartNumber),
    currentSeqNo,
    nextEpochSeqNo,
    remainingSeconds,
    chainTimestamp: chainTs,
    observedAt: new Date().toISOString(),
    source,
  });

  return String(epochStartNumber);
}

async function ackiGraphQl(query: string, timeoutMs: number): Promise<any> {
  const res = await fetch(ACKI_MAINNET_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  return res.json();
}

// Current epoch, derived from block height.
//
// Measured 2026-08-10: `blockchain{blocks(last:1)}` fails on mainnet roughly
// 7 times out of 8 with "pool timed out while waiting for an open connection"
// — the server's block-index pool is exhausted, while `blockchain{account}`
// on the same endpoint answers in 70ms. Each failure costs a fixed ~5s.
//
// The caller used to fall back to the contract's stored epoch whenever this
// returned null. That silently corrupted epoch tracking: the contract value
// LAGS the chain, so consecutive pulses alternated between two different
// numbers, and a single failed read landing between two good ones wiped the
// pending candidate (the confirm path deletes it when the value equals the
// previous one). Confirmation then needed two CONSECUTIVE successful reads —
// about a 1.4% chance per pulse pair — and 42% of observed candidates never
// confirmed, skipping whole epochs (and their sessions) outright.
//
// So: anchor on every successful read and extrapolate from the known block
// rate in between. A short extrapolation is far more accurate than a value
// from a different clock, and it keeps epoch tracking on ONE source.
async function readChainEpoch5mStart(): Promise<string | null> {
  // Read the chain clock first. Measured 2026-08-10 on mainnet: this answers in
  // ~70ms and succeeded 6/6, while `blocks(last:1)` in the SAME request failed
  // 5/6 with "pool timed out" and costs a fixed ~5s when it does. The endpoint's
  // block/transaction index is exhausted; `account` and `finalizedTimestamp`
  // are served fine.
  //
  // This used to call `blocks(last:1)` on every autopilot pulse — a ~5s blocking
  // call once per second, which both starved epoch detection and kept a
  // connection permanently occupied against the same pool the SDK submits
  // through.
  let chainTs: number | null = null;

  try {
    const json = await ackiGraphQl("{blockchain{finalizedTimestamp}}", 10000);
    const value = Number(json?.data?.blockchain?.finalizedTimestamp);
    chainTs = Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    chainTs = null;
  }

  if (chainTs === null) {
    return null;
  }

  const anchorAgeS = beeBlockAnchor ? chainTs - beeBlockAnchor.chainTs : Infinity;

  // Re-anchor on the real height occasionally. Both fields come from one
  // request so the pair shares a timestamp; the 5s cost is paid about once a
  // minute instead of once a second, and a failure just keeps the old anchor.
  const sinceAttemptS = chainTs - beeBlockAnchorAttemptTs;

  if (
    anchorAgeS >= BEE_BLOCK_ANCHOR_MAX_AGE_S &&
    sinceAttemptS >= BEE_BLOCK_ANCHOR_RETRY_S
  ) {
    beeBlockAnchorAttemptTs = chainTs;

    try {
      const json = await ackiGraphQl(
        "{blockchain{finalizedTimestamp blocks(last:1){edges{node{seq_no}}}}}",
        15000,
      );
      const seqNo = Number(
        json?.data?.blockchain?.blocks?.edges?.[0]?.node?.seq_no,
      );
      const pairedTs = Number(json?.data?.blockchain?.finalizedTimestamp);

      if (Number.isFinite(seqNo) && seqNo > 0 && Number.isFinite(pairedTs)) {
        beeBlockAnchor = { seqNo, chainTs: pairedTs };
        return updateChainEpochClock(seqNo, pairedTs, "chain");
      }
    } catch {
      // Keep the existing anchor and extrapolate below.
    }
  }

  if (!beeBlockAnchor) {
    return null;
  }

  const elapsedS = chainTs - beeBlockAnchor.chainTs;

  if (elapsedS < 0 || elapsedS > BEE_BLOCK_ANCHOR_HARD_LIMIT_S) {
    return null;
  }

  const estimated =
    beeBlockAnchor.seqNo + elapsedS * BEE_BLOCKS_PER_SECOND;

  return updateChainEpochClock(estimated, chainTs, "estimated");
}

async function observeBeeEpoch(
  miner: BeeMinerRecord,
  existingHandle?: BeeMinerHandle,
): Promise<{
  epochChanged: boolean;
  confirmed: boolean;
  data: Awaited<ReturnType<typeof beeReadMinerData>>;
} | null> {
  if (!miner.minerAddress) {
    return null;
  }

  const key = beeMinerKey(miner);
  const now = Date.now();

  if ((beeLastResetPollAt.get(key) ?? 0) + BEE_RESET_POLL_MS > now) {
    return null;
  }
  beeLastResetPollAt.set(key, now);

  const handle =
    existingHandle ??
    (await beeAcquireMiner({
      appId: miner.appId,
      minerAddress: miner.minerAddress,
      publicKey: miner.publicKey,
      secretKey: miner.secretKey,
    }));
  const contractData = await beeReadMinerData(handle);

  if (!contractData) {
    return null;
  }

  // Take the epoch from the chain's block height, not from the contract's
  // stored copy (see readChainEpoch5mStart above for why). Everything else —
  // tapSum and the per-epoch tap quota — still comes from the contract, which
  // is the authority for those. If the block read fails, fall back to the
  // stored value rather than stalling: a stale epoch is still better than no
  // decision, and the deadlock guard downstream covers the rest.
  const chainEpoch5mStart = await readChainEpoch5mStart();
  const data = chainEpoch5mStart
    ? { ...contractData, epoch5mStart: chainEpoch5mStart }
    : contractData;

  const previous =
    beeObservedEpoch5m.get(key) ?? miner.lastEpoch5mStart ?? null;

  // The two sources run on different clocks: the block height is current, the
  // contract's copy only advances when acceptTap/getReward touches it. Feeding
  // both into one candidate/confirmation state machine let a contract-sourced
  // pulse land between two chain-sourced ones and delete the pending
  // candidate, because it compares equal to the previous canonical value.
  // Measured 2026-08-10: 301 candidates produced only 175 confirmations, and
  // whole epochs (with their sessions) were skipped.
  //
  // When the chain height is unavailable, hold the last chain-derived epoch
  // instead of borrowing the contract's. Reporting `confirmed` matters: the
  // caller does `if (!epoch.confirmed) continue`, so returning false here would
  // also skip the stale-epoch deadlock guard below — turning a bad reading into
  // a full stall.
  if (!chainEpoch5mStart) {
    return previous
      ? {
          epochChanged: false,
          confirmed: true,
          data: { ...contractData, epoch5mStart: previous },
        }
      : { epochChanged: false, confirmed: false, data };
  }
  const updateObservedState = (epoch5mStart: string, changed: boolean) => {
    updateBeeMinerRecord(miner.id, (row) => {
      row.lastTapSum = data.tapSum;
      row.lastTapSumAt = new Date().toISOString();
      row.lastEpoch5mStart = epoch5mStart;
      if (changed) {
        row.lastEpoch5mChangedAt = new Date().toISOString();
      }
    });
  };

  // Establish a baseline only once after boot.  Every later epoch must be
  // observed twice, ten seconds apart, before it is allowed to reset a
  // session or collect a reward.  This mirrors CappAckiMiner's
  // "candidate ... awaiting confirmation; canonical=..." state.
  if (!previous) {
    beeObservedEpoch5m.set(key, data.epoch5mStart);
    beeEpochCandidate.delete(key);
    updateObservedState(data.epoch5mStart, false);
    return { epochChanged: false, confirmed: true, data };
  }

  if (data.epoch5mStart === previous) {
    beeEpochCandidate.delete(key);
    updateObservedState(data.epoch5mStart, false);
    return { epochChanged: false, confirmed: true, data };
  }

  const candidate = beeEpochCandidate.get(key);
  const confirmations = candidate?.value === data.epoch5mStart
    ? candidate.confirmations + 1
    : 1;
  beeEpochCandidate.set(key, { value: data.epoch5mStart, confirmations });

  if (confirmations < 2) {
    console.log("Bee canonical epoch candidate awaiting confirmation:", {
      walletName: miner.walletName,
      candidate: data.epoch5mStart,
      canonical: previous,
    });
    return { epochChanged: false, confirmed: false, data };
  }

  beeObservedEpoch5m.set(key, data.epoch5mStart);
  beeEpochCandidate.delete(key);
  beeSessionEpoch5m.delete(key);
  beeEpochRecoveryUntil.delete(key);
  updateObservedState(data.epoch5mStart, true);
  console.log("Bee canonical epoch confirmed:", {
    walletName: miner.walletName,
    epoch5mStart: data.epoch5mStart,
    previousEpoch5mStart: previous,
  });
  return { epochChanged: true, confirmed: true, data };
}

async function waitForBeeMinerReady(
  handle: BeeMinerHandle,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (beeCanStartMining(handle)) {
      return true;
    }
    await sleep(BEE_CONGESTION_RETRY_DELAY_MS);
  }

  return beeCanStartMining(handle);
}

type BeeSettlement = {
  accepted: boolean;
  source: "session_accepted" | "tap_sum" | "sdk_error" | "timeout";
  summary: ReturnType<typeof beeSummarizeMinerEvents>;
  data: Awaited<ReturnType<typeof beeReadMinerData>>;
};

async function waitForBeeSubmissionSettlement(params: {
  handle: BeeMinerHandle;
  events: any[];
  tapSumBefore: number | null;
}): Promise<BeeSettlement> {
  const deadline = Date.now() + BEE_SUBMISSION_SETTLE_TIMEOUT_MS;
  let lastData = await beeReadMinerData(params.handle);

  while (Date.now() < deadline) {
    const summary = beeSummarizeMinerEvents(params.events);
    if (summary.sawSessionAccepted) {
      return { accepted: true, source: "session_accepted", summary, data: lastData };
    }
    if (summary.errors.length) {
      return { accepted: false, source: "sdk_error", summary, data: lastData };
    }

    if (
      params.tapSumBefore !== null &&
      lastData !== null &&
      lastData.tapSum > params.tapSumBefore
    ) {
      return { accepted: true, source: "tap_sum", summary, data: lastData };
    }

    await sleep(BEE_SUBMISSION_SETTLE_POLL_MS);
    lastData = await beeReadMinerData(params.handle);
  }

  return {
    accepted: false,
    source: "timeout",
    summary: beeSummarizeMinerEvents(params.events),
    data: lastData,
  };
}

async function runBeeContinuousSession(
  miner: BeeMinerRecord,
  canonicalEpoch5mStart: string,
): Promise<void> {
  if (!miner.minerAddress) {
    return;
  }

  const key = beeMinerKey(miner);
  if (beeSessionRunning.has(key)) {
    return;
  }
  beeSessionRunning.add(key);
  let submissionCritical = false;
  const beginSubmissionCritical = () => {
    if (!submissionCritical) {
      submissionCritical = true;
      beeEnterChainCritical();
    }
  };
  // Bee's SDK keeps a live GraphQL event reader for the whole 135-second
  // computation, not only for root/proof submission. Keep low-priority wallet
  // scans out of that entire window; they resume as soon as settlement ends.
  beginSubmissionCritical();

  try {
    const handle = await beeAcquireMiner({
      appId: miner.appId,
      minerAddress: miner.minerAddress,
      publicKey: miner.publicKey,
      secretKey: miner.secretKey,
    });

    if (!beeCanStartMining(handle)) {
      return;
    }

    const startedAt = new Date();
    const dataBefore = await beeReadMinerData(handle);
    if (dataBefore) {
      // From this point this epoch has consumed its single logical session,
      // even if the submission later becomes ambiguous.
      beeSessionEpoch5m.set(key, canonicalEpoch5mStart);
      updateBeeMinerRecord(miner.id, (row) => {
        row.lastSessionEpoch5mStart = canonicalEpoch5mStart;
        row.lastSessionEpochStatus = "pending";
      });
    }
    let result = await beeRunMiningSession(handle, {
      durationMs: BEE_MINING_SESSION_DURATION_MS,
      tapWindowMs: BEE_MINING_TAP_WINDOW_MS,
      tapCount: BEE_MINING_TAP_COUNT,
      onBeforeSubmit: beginSubmissionCritical,
    });
    let retries = 0;
    let retryReadyTimedOut = false;

    // This mirrors the reference's "congestion retry 1/3 in 1s (same Miner)".
    // There is deliberately no wall-clock slot test here: the SDK lifecycle,
    // not a fixed 5-minute timer, determines when another session is safe.
    while (
      retries < BEE_CONGESTION_RETRIES &&
      isRootSubmitFailure(result.submitSummary.errors)
    ) {
      retries += 1;
      console.warn("Bee congestion retry (same miner):", {
        walletName: miner.walletName,
        attempt: `${retries}/${BEE_CONGESTION_RETRIES}`,
      });
      await sleep(BEE_CONGESTION_RETRY_DELAY_MS);

      // `submit_session_root` can fail before the worker has transitioned
      // back to idle.  The reference miner remains in WAITING in this state;
      // calling start() anyway manufactures a zero-tap MINER_CANNOT_START
      // pseudo-session and hides the real retry outcome.
      const ready = await waitForBeeMinerReady(
        handle,
        BEE_CONGESTION_READY_TIMEOUT_MS,
      );

      if (!ready) {
        retryReadyTimedOut = true;
        console.warn("Bee congestion retry waiting for Miner readiness timed out:", {
          walletName: miner.walletName,
          waitedSeconds: Math.round(BEE_CONGESTION_READY_TIMEOUT_MS / 1000),
        });
        break;
      }

      result = await beeRunMiningSession(handle, {
        durationMs: BEE_MINING_SESSION_DURATION_MS,
        tapWindowMs: BEE_MINING_TAP_WINDOW_MS,
        tapCount: BEE_MINING_TAP_COUNT,
        onBeforeSubmit: beginSubmissionCritical,
      });
    }

    // Root/proof submission is a chain-critical section.  The broad monitor
    // is paused by this flag so it cannot compete for the same public GraphQL
    // pool while the SDK is waiting for acceptance.
    let settlement: BeeSettlement | null = null;
    if (!retryReadyTimedOut) {
      beeSubmissionSettling.add(key);
      try {
        settlement = await waitForBeeSubmissionSettlement({
          handle,
          events: result.events,
          tapSumBefore: dataBefore?.tapSum ?? null,
        });
      } finally {
        beeSubmissionSettling.delete(key);
      }
    }

    // A root failure commonly arrives after runMiningSession()'s submit grace,
    // during settlement. The old retry loop above therefore saw no error and
    // `retries` stayed zero. Retry this definite zero-delta failure once, but
    // only while the canonical epoch is still the one this session belongs to.
    while (
      !retryReadyTimedOut &&
      settlement &&
      !settlement.accepted &&
      settlement.source === "sdk_error" &&
      isRootSubmitFailure(settlement.summary.errors) &&
      retries < BEE_CONGESTION_RETRIES
    ) {
      const currentEpoch5mStart = await readChainEpoch5mStart();
      if (
        currentEpoch5mStart &&
        currentEpoch5mStart !== canonicalEpoch5mStart
      ) {
        console.warn("Bee late root retry skipped after canonical epoch change:", {
          walletName: miner.walletName,
          sessionEpoch5mStart: canonicalEpoch5mStart,
          currentEpoch5mStart,
        });
        break;
      }

      retries += 1;
      console.warn("Bee late root failure retry (same miner):", {
        walletName: miner.walletName,
        attempt: `${retries}/${BEE_CONGESTION_RETRIES}`,
        delayMs: BEE_CONGESTION_RETRY_DELAY_MS,
      });
      await sleep(BEE_CONGESTION_RETRY_DELAY_MS);

      const ready = await waitForBeeMinerReady(
        handle,
        BEE_CONGESTION_READY_TIMEOUT_MS,
      );
      if (!ready) {
        retryReadyTimedOut = true;
        break;
      }

      const retryTapSumBefore = settlement.data?.tapSum ?? dataBefore?.tapSum ?? null;
      result = await beeRunMiningSession(handle, {
        durationMs: BEE_MINING_SESSION_DURATION_MS,
        tapWindowMs: BEE_MINING_TAP_WINDOW_MS,
        tapCount: BEE_MINING_TAP_COUNT,
        onBeforeSubmit: beginSubmissionCritical,
      });

      beeSubmissionSettling.add(key);
      try {
        settlement = await waitForBeeSubmissionSettlement({
          handle,
          events: result.events,
          tapSumBefore: retryTapSumBefore,
        });
      } finally {
        beeSubmissionSettling.delete(key);
      }
    }

    if (submissionCritical) {
      beeLeaveChainCritical();
      submissionCritical = false;
    }
    const finalSummary = settlement?.summary ?? result.submitSummary;
    const dataAfter = settlement?.data ?? (await beeReadMinerData(handle));
    beeLastEventIndex.set(miner.id, result.eventIndexAtReturn);

    console.log("Bee continuous session finished:", {
      walletName: miner.walletName,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      taps: result.taps,
      retries,
      retryReadyTimedOut,
      settlement: settlement?.source ?? "not_attempted",
      tapSumBefore: dataBefore?.tapSum ?? null,
      tapSumAfter: dataAfter?.tapSum ?? null,
      tapDelta:
        dataBefore && dataAfter ? dataAfter.tapSum - dataBefore.tapSum : null,
      sawSubmitRoot: finalSummary.sawSubmitRoot,
      sawSubmitProof: finalSummary.sawSubmitProof,
      sawSessionAccepted: finalSummary.sawSessionAccepted,
      // Root-cause instrumentation (2026-08-10). The action list and the SDK's
      // own status stream were collected but never printed, so a chain-side
      // `session_rejected` looked identical to a session that just went quiet.
      sawSessionRejected: finalSummary.sawSessionRejected,
      actions: finalSummary.actions,
      statuses: finalSummary.statuses,
      error: result.error,
      eventErrors: finalSummary.errors.slice(0, 3),
      // Only populated when the SDK reported an error or a rejection.
      rawEvents: finalSummary.rawOnError,
    });

    updateBeeMinerRecord(miner.id, (row) => {
      row.lastSessionStartedAt = startedAt.toISOString();
      // Do not present a failed/unfinished submission as a completed session.
      if (!retryReadyTimedOut && settlement?.accepted) {
        row.lastSessionAt = new Date().toISOString();
        row.lastTapsSent = result.taps;
        row.lastSessionEpochStatus =
          settlement.source === "session_accepted" ? "accepted" : "tap_sum";
      }
      if (dataAfter) {
        row.lastTapSum = dataAfter.tapSum;
        row.lastTapSumAt = new Date().toISOString();
        // Never overwrite the canonical block-derived epoch with the Miner
        // contract's stored copy; that copy advances only when the contract is
        // touched and can lag by one or more epochs.
        row.lastEpoch5mStart = canonicalEpoch5mStart;
      }
    });

    if (retryReadyTimedOut) {
      // The same instance never became idle after the failed root submission.
      // Rebuild on the next pulse, while preserving the active subscription.
      beeDiscardMiner({
        appId: miner.appId,
        minerAddress: miner.minerAddress,
        publicKey: miner.publicKey,
      });
      beeLastEventIndex.delete(miner.id);
      updateBeeMinerRecord(miner.id, (row) => {
        row.lastError = "CONGESTION_RETRY_READY_TIMEOUT";
        row.lastSessionEpochStatus = "failed";
        row.status = "active";
      });
      beeEpochRecoveryUntil.set(key, Date.now() + BEE_EPOCH_RECOVERY_DELAY_MS);
      await sleep(BEE_RESTART_FLOOR_MS);
      return;
    }

    if (!settlement?.accepted) {
      const message =
        result.error ||
        finalSummary.errors[0] ||
        `SUBMISSION_${settlement?.source.toUpperCase() ?? "UNKNOWN"}`;
      beeDiscardMiner({
        appId: miner.appId,
        minerAddress: miner.minerAddress,
        publicKey: miner.publicKey,
      });
      beeLastEventIndex.delete(miner.id);
      updateBeeMinerRecord(miner.id, (row) => {
        row.lastError = message;
        row.lastSessionEpochStatus = "failed";
        row.status = "active";
      });
      console.warn("Bee session was not accepted; Miner will be rebuilt:", {
        walletName: miner.walletName,
        settlement: settlement?.source,
        message,
        recoverySeconds: Math.round(BEE_EPOCH_RECOVERY_DELAY_MS / 1000),
      });
      beeEpochRecoveryUntil.set(key, Date.now() + BEE_EPOCH_RECOVERY_DELAY_MS);
      await sleep(BEE_RESTART_FLOOR_MS);
      return;
    }

    const message = result.error || finalSummary.errors[0] || null;
    if (!message) {
      updateBeeMinerRecord(miner.id, (row) => {
        row.lastError = null;
      });
      console.log("Bee safety net holding before next session:", {
        walletName: miner.walletName,
        safetyNetSeconds: Math.round(BEE_SAFETY_NET_MS / 1000),
      });
      await sleep(BEE_SAFETY_NET_MS);
      return;
    }

    if (message === "MINER_CANNOT_START") {
      updateBeeMinerRecord(miner.id, (row) => {
        row.lastError = "MINER_NOT_READY_AFTER_RETRY";
        row.status = "active";
      });
      await sleep(BEE_RESTART_FLOOR_MS);
      return;
    }

    // Root failures get the same-Miner retry above.  Only after those retries
    // are exhausted do we rebuild the instance, as the reference does.
    if (finalSummary.errors.length || !isTransientMiningFault(message)) {
      beeDiscardMiner({
        appId: miner.appId,
        minerAddress: miner.minerAddress,
        publicKey: miner.publicKey,
      });
      beeLastEventIndex.delete(miner.id);
    }

    updateBeeMinerRecord(miner.id, (row) => {
      row.lastError = message;
      row.status = isTransientMiningFault(message) ? "active" : "error";
    });
    await sleep(BEE_RESTART_FLOOR_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Bee continuous session failed:", {
      walletName: miner.walletName,
      message,
    });
    updateBeeMinerRecord(miner.id, (row) => {
      row.lastError = message;
      row.status = isTransientMiningFault(message) ? "active" : "error";
    });
  } finally {
    beeSubmissionSettling.delete(key);
    beeSessionRunning.delete(key);
    if (submissionCritical) {
      beeLeaveChainCritical();
    }
  }
}

async function runBeeAutopilotPulse(): Promise<void> {
  if (beeAutopilotPulseRunning || !BEE_APP_ID) {
    return;
  }
  beeAutopilotPulseRunning = true;

  try {
    const state = readBeeMinerState();
    const paymentsState = readPaymentsState();
    const now = Date.now();
    const activeMiners = state.miners.filter((miner) =>
      isBeeMinerEligible(miner, paymentsState, now, state.miners),
    );
    let availableStarts = Math.max(0, BEE_MINING_CONCURRENCY - beeSessionRunning.size);

    for (const miner of activeMiners) {
      try {
        const key = beeMinerKey(miner);
        // Never probe the same SDK Miner while a session or reward claim owns
        // it. Those overlapping readMinerData/event queries were filling the
        // public GraphQL connection pool even after Bee moved to its own PM2
        // process.
        if (
          !miner.minerAddress ||
          beeSessionRunning.has(key) ||
          beeSubmissionSettling.has(key) ||
          beeClaimRunning.has(key) ||
          beePendingEpochClaims.has(key)
        ) {
          continue;
        }
        const handle = await beeAcquireMiner({
          appId: miner.appId,
          minerAddress: miner.minerAddress,
          publicKey: miner.publicKey,
          secretKey: miner.secretKey,
        });

        // Read the canonical epoch before considering a start.  No wall-clock
        // timer is allowed to open a second session in an unchanged epoch.
        const epoch = await observeBeeEpoch(miner, handle);
        if (!epoch || !epoch.data || !epoch.confirmed) {
          continue;
        }
        if (epoch.epochChanged) {
          beePendingEpochRefresh.set(key, epoch.data.epoch5mStart);
        }

        const refreshEpoch = beePendingEpochRefresh.get(key);
        if (refreshEpoch) {
          // A session owns the current SDK instance until its root has either
          // been accepted or explicitly failed.  Do not reset it underneath a
          // live submission.
          if (
            beeSessionRunning.has(key) ||
            beeSubmissionSettling.has(key) ||
            beeClaimRunning.has(key) ||
            beePendingEpochClaims.has(key)
          ) {
            continue;
          }

          const fresh = readBeeMinerState().miners.find((row) => row.id === miner.id);
          if (fresh?.lastClaimedEpoch5mStart !== refreshEpoch) {
            queueBeeEpochClaim(miner, refreshEpoch);
            continue;
          }

          // Claim succeeded: rebuild once at the canonical boundary, exactly
          // like the reference miner's "reset / new Miner" transition.
          beePendingEpochRefresh.delete(key);
          beeDisposeMiner({
            appId: miner.appId,
            minerAddress: miner.minerAddress,
            publicKey: miner.publicKey,
          });
          beeLastEventIndex.delete(miner.id);
          continue;
        }
        if (
          beeSessionRunning.has(key) ||
          beeSubmissionSettling.has(key) ||
          beeClaimRunning.has(key) ||
          beePendingEpochClaims.has(key) ||
          (beeEpochRecoveryUntil.get(key) ?? 0) > Date.now() ||
          availableStarts < 1
        ) {
          continue;
        }
        // One session per epoch — but `epoch_5m_start` is a STORED contract
        // field, not a clock. Miner.sol only advances it inside _updateEpoch,
        // which runs during acceptTap/getReward. So it moves only when we
        // touch the contract, and "wait for a new epoch before mining" is a
        // deadlock the moment mining stops for any reason: nothing touches the
        // contract, so the epoch never advances, so nothing ever starts.
        // Observed 2026-08-09: mining sat idle 95 minutes with the recorded
        // epoch frozen at 77269000 while the chain had moved on 16,582 blocks.
        // Break the cycle by starting anyway once the epoch has been stale far
        // longer than a real epoch could last (~335s at ~2.98 blocks/s).
        const sameEpochAsLastSession =
          beeSessionEpoch5m.get(key) === epoch.data.epoch5mStart ||
          miner.lastSessionEpoch5mStart === epoch.data.epoch5mStart;

        const epochStaleFor =
          Date.now() - Date.parse(miner.lastEpoch5mChangedAt ?? miner.lastSessionAt ?? "");
        const epochDeadlocked =
          Number.isFinite(epochStaleFor) && epochStaleFor > BEE_EPOCH_STALE_MAX_MS;

        if (sameEpochAsLastSession && epochDeadlocked) {
          console.warn("Bee epoch stalled — forcing a session to advance it:", {
            walletName: miner.walletName,
            epoch5mStart: epoch.data.epoch5mStart,
            staleSeconds: Math.round(epochStaleFor / 1000),
          });
        } else if (
          sameEpochAsLastSession ||
          beeClaimRunning.has(key) ||
          beePendingEpochClaims.has(key)
        ) {
          continue;
        }

        if (beeCanStartMining(handle)) {
          availableStarts -= 1;
          void runBeeContinuousSession(miner, epoch.data.epoch5mStart);
        }
      } catch (error) {
        console.warn("Bee autopilot miner probe failed:", {
          walletName: miner.walletName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    beeAutopilotPulseRunning = false;
  }
}

function startBeeMiningScheduler(): boolean {
  if (!BEE_MINING_ENABLED) {
    console.log("Bee mining scheduler disabled by BEE_MINING_ENABLED=false");
    return false;
  }

  if (!BEE_APP_ID) {
    console.log(
      "Bee mining scheduler NOT started: BEE_APP_ID is not set. Get one from " +
        "the Acki Nacki team (contact @EugeneDAO on Telegram) and set it in .env.",
    );
    return false;
  }

  if (beeMiningTimer) {
    clearTimeout(beeMiningTimer);
  }

  console.log("Bee mining state-driven autopilot started:", {
    sessionSeconds: Math.round(BEE_MINING_SESSION_DURATION_MS / 1000),
    tapWindowSeconds: Math.round(BEE_MINING_TAP_WINDOW_MS / 1000),
    tapCount: BEE_MINING_TAP_COUNT,
    concurrency: BEE_MINING_CONCURRENCY,
    pulseMs: BEE_ENGINE_PULSE_MS,
    resetPollSeconds: Math.round(BEE_RESET_POLL_MS / 1000),
    claimTrigger: "canonical chain epoch transition",
  });

  const scheduleNext = (delayMs: number) => {
    beeMiningTimer = setTimeout(() => {
      void runBeeAutopilotPulse().finally(() => scheduleNext(BEE_ENGINE_PULSE_MS));
    }, delayMs);
  };

  scheduleNext(BEE_MINING_INITIAL_DELAY_MS);
  return true;
}

export function startBeeWorker(): void {
  if (!startBeeMiningScheduler()) {
    throw new Error("Bee worker could not start; check BEE_MINING_ENABLED/BEE_APP_ID");
  }

  console.log("Bee isolated worker online:", {
    pid: process.pid,
    role: "bee-only",
  });

  const stop = (signal: "SIGINT" | "SIGTERM") => {
    if (beeMiningTimer) clearTimeout(beeMiningTimer);
    beeReleaseChainCriticalLease();
    console.log("Bee isolated worker stopping:", { signal });
  };

  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}

// Fix: SHELL payment detection for subscription plans. We only have
// reliable visibility into the payments wallet's CUMULATIVE balance (not a
// per-transfer memo/comment field), so matching works by comparing the
// balance delta since the last check against pending invoices' exact
// amounts — each invoice has a unique small fractional offset baked in
// (see services/payments.ts) specifically so this works even when several
// people pay around the same time.
const PAYMENTS_CHECK_INTERVAL_MS =
  Number(process.env.PAYMENTS_CHECK_INTERVAL_SECONDS || 90) * 1000;
const PAYMENTS_CHECK_ENABLED =
  String(process.env.PAYMENTS_CHECK_ENABLED || "false").toLowerCase() === "true";

// TON / USDT rail. Separate switch from the SHELL one above: SHELL stays off
// while this is the live way to pay.
const TON_PAYMENTS_ADDRESS = String(process.env.TON_PAYMENTS_ADDRESS || "").trim();
const TON_PAYMENTS_CHECK_ENABLED =
  String(process.env.TON_PAYMENTS_CHECK_ENABLED || "false").toLowerCase() === "true" &&
  Boolean(TON_PAYMENTS_ADDRESS);
const TON_PAYMENTS_CHECK_INTERVAL_MS =
  Number(process.env.TON_PAYMENTS_CHECK_INTERVAL_SECONDS || 45) * 1000;
const TONAPI_KEY = String(process.env.TONAPI_KEY || "").trim() || undefined;

let tonPaymentsTimer: ReturnType<typeof setTimeout> | undefined;
let tonPaymentsRunning = false;

async function runTonPaymentsCheckTick(bot: Telegraf<any>) {
  if (tonPaymentsRunning) return;

  tonPaymentsRunning = true;

  try {
    const state = readPaymentsState();
    const sinceLt = Number(state.tonLastLt || 0);
    let transfers;

    try {
      transfers = await fetchIncomingPayments({
        friendlyAddress: TON_PAYMENTS_ADDRESS,
        sinceLt,
        ...(TONAPI_KEY ? { apiKey: TONAPI_KEY } : {}),
      });
    } catch (error) {
      console.error("TON payments check: fetch failed:", {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (!transfers.length) return;

    // First run: adopt the newest lt as the baseline and process nothing.
    // Without this the wallet's entire history gets replayed on startup —
    // including old real payments and the phishing dust TON wallets collect —
    // none of which relates to an invoice we issued.
    if (!sinceLt) {
      state.tonLastLt = transfers[transfers.length - 1]!.lt;
      writePaymentsState(state);
      console.log("TON payments: baseline established:", {
        tonLastLt: state.tonLastLt,
        skipped: transfers.length,
      });
      return;
    }

    const now = Date.now();
    let credited = 0;

    for (const transfer of transfers) {
      // Advance the cursor for every transfer we look at, matched or not, so
      // spam never gets re-examined. TON wallets receive a steady stream of
      // 0-value dust carrying phishing text in the comment; it must not stall
      // the cursor or reach a human.
      state.tonLastLt = Math.max(Number(state.tonLastLt || 0), transfer.lt);

      if (BigInt(transfer.amountRaw) <= 0n) continue;

      const code = extractInvoiceCode(transfer.comment);

      if (!code) {
        // Real money with no code — a human has to sort this out, but the
        // comment itself is never echoed anywhere: it is attacker-controlled
        // text and has carried homoglyph phishing URLs in practice.
        console.warn("TON payments: paid transfer without a usable code:", {
          lt: transfer.lt,
          currency: transfer.currency,
          amount: formatPayAmount(transfer.amountRaw, transfer.currency),
        });
        continue;
      }

      const invoice = state.pendingInvoices.find(
        (item) => item.code && item.code.toUpperCase() === code,
      );

      if (!invoice) {
        console.warn("TON payments: code matched no pending invoice:", {
          lt: transfer.lt,
          code,
          currency: transfer.currency,
          amount: formatPayAmount(transfer.amountRaw, transfer.currency),
        });
        continue;
      }

      // Admin test invoices deliberately live outside the public PLANS list.
      // They still need to resolve here after an on-chain transfer arrives.
      const plan = resolvePaidPlan(invoice.planId);

      if (!plan) continue;

      // The invoice quotes both currencies; charge against whichever one
      // actually arrived. A TON payment against an invoice with no TON price
      // (rate lookup failed at creation) has no agreed amount, so it cannot
      // be auto-credited.
      const expectedRaw =
        transfer.currency === "ton" ? invoice.amountTonRaw : invoice.amountRaw;

      if (!expectedRaw) {
        console.warn("TON payments: currency not quoted on this invoice:", {
          code,
          currency: transfer.currency,
        });
        continue;
      }

      // A valid code must still be backed by the right amount, otherwise a
      // dust transfer quoting a leaked code would buy a subscription.
      // USDT gets a flat cent of slack; TON gets 2%, since its amount was
      // derived from a rate and rounded.
      const expected = BigInt(expectedRaw);
      const paid = BigInt(transfer.amountRaw);
      const tolerance =
        transfer.currency === "ton"
          ? expected / 50n
          : BigInt(usdtAmountToRaw(0.01));

      if (paid + tolerance < expected) {
        const unit = transfer.currency === "ton" ? "TON" : "USDT";

        console.warn("TON payments: underpaid invoice:", {
          code,
          currency: transfer.currency,
          expected: formatPayAmount(expectedRaw, transfer.currency),
          paid: formatPayAmount(transfer.amountRaw, transfer.currency),
        });

        try {
          await bot.telegram.sendMessage(
            invoice.chatId,
            [
              "⚠️ Ödemen eksik göründü.",
              "",
              `Beklenen: ${formatPayAmount(expectedRaw, transfer.currency)} ${unit}`,
              `Gelen: ${formatPayAmount(transfer.amountRaw, transfer.currency)} ${unit}`,
              "",
              "Yöneticiyle iletişime geç.",
            ].join("\n"),
          );
        } catch {
          // Delivery failure must not stop the tick.
        }

        continue;
      }

      const activeUntil = grantSubscription(
        state,
        invoice.chatId,
        plan.id,
        plan.days,
        {
          paid: true,
          paymentSource:
            String(
              transfer.currency ||
              "ton",
            ),
        },
      );
      state.pendingInvoices = state.pendingInvoices.filter(
        (item) => item.id !== invoice.id,
      );
      appendPaymentHistory(state, {
        id: `ton:${transfer.eventId || transfer.lt}:${invoice.id}`,
        status: "confirmed",
        source: transfer.currency === "ton" ? "ton" : "usdt",
        chatId: invoice.chatId,
        planId: plan.id,
        invoiceId: invoice.id,
        amountRaw: transfer.amountRaw,
        currency: transfer.currency,
        transactionId: transfer.eventId || String(transfer.lt),
        senderAddress: transfer.senderAddress || null,
        invoiceCreatedAt: invoice.createdAt,
        recordedAt: new Date().toISOString(),
        activeUntil,
      });
      credited += 1;

      console.log("TON payments: subscription activated:", {
        chatId: invoice.chatId,
        plan: plan.id,
        currency: transfer.currency,
        amount: formatPayAmount(transfer.amountRaw, transfer.currency),
        activeUntil,
      });

      try {
        await bot.telegram.sendMessage(
          invoice.chatId,
          [
            "✅ Ödemen alındı, aboneliğin aktif.",
            "",
            `Plan: ${plan.label} (${plan.days} gün)`,
            `Tutar: ${formatPayAmount(transfer.amountRaw, transfer.currency)} ${transfer.currency === "ton" ? "TON" : "USDT"}`,
            `Bitiş: ${new Date(activeUntil).toLocaleString("tr-TR")}`,
            "",
            "Madenciliği başlatmak için: /miner_start",
          ].join("\n"),
        );
      } catch (error) {
        console.error("TON payments: activation notice failed:", {
          chatId: invoice.chatId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Drop invoices nobody paid in time, so a leaked code cannot be redeemed
    // days later.
    state.pendingInvoices = state.pendingInvoices.filter(
      (item) => new Date(item.expiresAt).getTime() > now,
    );

    writePaymentsState(state);

    if (credited) {
      console.log("TON payments check finished:", { credited });
    }
  } finally {
    tonPaymentsRunning = false;
  }
}

function startTonPaymentsScheduler(bot: Telegraf<any>) {
  if (!TON_PAYMENTS_CHECK_ENABLED) {
    console.log(
      "TON payments scheduler disabled (TON_PAYMENTS_CHECK_ENABLED / TON_PAYMENTS_ADDRESS)",
    );
    return;
  }

  if (tonPaymentsTimer) {
    clearTimeout(tonPaymentsTimer);
  }

  const scheduleNext = (delayMs: number) => {
    tonPaymentsTimer = setTimeout(() => {
      void runTonPaymentsCheckTick(bot).finally(() =>
        scheduleNext(TON_PAYMENTS_CHECK_INTERVAL_MS),
      );
    }, delayMs);
  };

  console.log("TON payments scheduler started:", {
    intervalSeconds: Math.round(TON_PAYMENTS_CHECK_INTERVAL_MS / 1000),
    address: TON_PAYMENTS_ADDRESS,
    hasApiKey: Boolean(TONAPI_KEY),
  });

  scheduleNext(TON_PAYMENTS_CHECK_INTERVAL_MS);
}

// NACKL is currency id 1 on Acki Nacki. It has its own transfer cursor and
// scheduler so an unavailable legacy SHELL balance query cannot delay native
// token payments.
const NACKL_PAYMENTS_CHECK_ENABLED =
  String(process.env.NACKL_PAYMENTS_CHECK_ENABLED || "false").toLowerCase() ===
    "true" && Boolean(NACKL_PAYMENTS_WALLET_NAME);
const NACKL_PAYMENTS_CHECK_INTERVAL_MS =
  Number(process.env.NACKL_PAYMENTS_CHECK_INTERVAL_SECONDS || 45) * 1000;

// account.info can advance before the indexed messages query catches up.
// Keep rescanning a changed LT for at least 90s before considering it stable.
const NACKL_LT_SETTLE_MS = 90 * 1000;

let nacklPaymentsTimer: ReturnType<typeof setTimeout> | undefined;
let nacklPaymentsRunning = false;

async function runNacklPaymentsCheckTick(bot: Telegraf<any>) {
  if (nacklPaymentsRunning || beeIsChainCritical()) return;
  nacklPaymentsRunning = true;

  try {
    // Once the initial baseline exists, there is nothing useful to observe
    // when nobody has an active NACKL invoice. Keep the scheduler alive, but
    // make idle ticks local-only instead of hitting the chain every 45 seconds.
    const idleSnapshot = readPaymentsState();
    const idleNow = Date.now();
    const hasActiveNacklInvoice = (idleSnapshot.pendingInvoices || []).some(
      (invoice) =>
        invoice.currency === "nackl" &&
        new Date(invoice.expiresAt).getTime() > idleNow,
    );

    if (idleSnapshot.nacklBaselineReady && !hasActiveNacklInvoice) {
      return;
    }

    // Cheap change detector: account.info.last_trans_lt is served by the
    // lightweight account path. Only hit the expensive messages index when
    // the payments wallet actually changed.
    let currentNacklTransactionLt: string | null = null;

    try {
      const accountInfo = await getShellBalance(NACKL_PAYMENTS_WALLET_NAME);
      currentNacklTransactionLt = accountInfo.lastTransactionLt;

      const snapshot = readPaymentsState();

      if (
        snapshot.nacklBaselineReady &&
        currentNacklTransactionLt &&
        snapshot.nacklLastTransactionLt === currentNacklTransactionLt
      ) {
        return;
      }
    } catch (error) {
      console.error("NACKL payments check: LT precheck failed:", {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let transfers;

    try {
      transfers = await getIncomingNacklTransfers(
        NACKL_PAYMENTS_WALLET_NAME,
        20,
      );
    } catch (error) {
      console.error("NACKL payments check: fetch failed:", {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // Read only after the network call. This narrows the window in which the
    // TON/Stars handlers could update the shared file before this tick writes.
    const state = readPaymentsState();
    const seen = new Set(state.seenNacklMessageIds || []);

    if (!state.nacklBaselineReady) {
      for (const transfer of transfers) seen.add(transfer.id);
      state.seenNacklMessageIds = Array.from(seen).slice(-1000);
      state.nacklBaselineReady = true;
      state.nacklLastTransactionLt = currentNacklTransactionLt;
      state.nacklPendingTransactionLt = null;
      state.nacklPendingTransactionSince = null;
      writePaymentsState(state);
      console.log("NACKL payments: baseline established:", {
        skipped: transfers.length,
      });
      return;
    }

    const now = Date.now();
    let credited = 0;
    const notifications: Array<{
      chatId: number;
      plan: Plan;
      amountRaw: string;
      activeUntil: string;
    }> = [];

    for (const transfer of transfers) {
      if (seen.has(transfer.id)) continue;
      seen.add(transfer.id);
      if (BigInt(transfer.nacklValueRaw) <= 0n) continue;

      const matches = state.pendingInvoices.filter(
        (invoice) =>
          invoice.currency === "nackl" &&
          new Date(invoice.expiresAt).getTime() > now &&
          invoice.amountRaw === transfer.nacklValueRaw,
      );

      if (matches.length !== 1) {
        console.warn("NACKL payments: incoming transfer has no unique invoice match:", {
          id: transfer.id,
          amountNackl: formatNacklAmount(transfer.nacklValueRaw),
          exactMatchCount: matches.length,
        });
        continue;
      }

      const invoice = matches[0]!;
      const plan = resolvePaidPlan(invoice.planId);
      if (!plan) continue;

      const activeUntil = grantSubscription(
        state,
        invoice.chatId,
        plan.id,
        plan.days,
        {
          paid: true,
          paymentSource: "nackl",
        },
      );
      state.pendingInvoices = state.pendingInvoices.filter(
        (item) => item.id !== invoice.id,
      );
      appendPaymentHistory(state, {
        id: `nackl:${transfer.id}`,
        status: "confirmed",
        source: "nackl",
        chatId: invoice.chatId,
        planId: plan.id,
        invoiceId: invoice.id,
        amountRaw: transfer.nacklValueRaw,
        currency: "nackl",
        transactionId: transfer.id,
        senderAddress: transfer.src || null,
        invoiceCreatedAt: invoice.createdAt,
        recordedAt: new Date().toISOString(),
        activeUntil,
      });
      credited += 1;

      console.log("NACKL payments: subscription activated:", {
        chatId: invoice.chatId,
        plan: plan.id,
        amountNackl: formatNacklAmount(transfer.nacklValueRaw),
        activeUntil,
      });
      notifications.push({
        chatId: invoice.chatId,
        plan,
        amountRaw: transfer.nacklValueRaw,
        activeUntil,
      });
    }

    state.seenNacklMessageIds = Array.from(seen).slice(-1000);
    state.pendingInvoices = state.pendingInvoices.filter(
      (invoice) => new Date(invoice.expiresAt).getTime() > now,
    );
    if (currentNacklTransactionLt) {
      const pendingSameLt =
        state.nacklPendingTransactionLt === currentNacklTransactionLt;
      const pendingSince =
        typeof state.nacklPendingTransactionSince === "number"
          ? state.nacklPendingTransactionSince
          : null;

      if (
        pendingSameLt &&
        pendingSince !== null &&
        Date.now() - pendingSince >= NACKL_LT_SETTLE_MS
      ) {
        // The same account LT survived the settle window and the messages
        // index has now been scanned repeatedly. It is safe to make it stable.
        state.nacklLastTransactionLt = currentNacklTransactionLt;
        state.nacklPendingTransactionLt = null;
        state.nacklPendingTransactionSince = null;
      } else if (!pendingSameLt) {
        // First sighting of this LT. Do not advance the stable cursor yet:
        // give the messages index time to catch up.
        state.nacklPendingTransactionLt = currentNacklTransactionLt;
        state.nacklPendingTransactionSince = Date.now();
      }
    }

    writePaymentsState(state);

    // Persist the credit and cursor before making any Telegram request. A
    // slow notification must never leave a paid invoice replayable.
    for (const notice of notifications) {
      try {
        await bot.telegram.sendMessage(
          notice.chatId,
          [
            "✅ NACKL ödemen alındı, aboneliğin aktif.",
            "",
            `Plan: ${notice.plan.label} (${notice.plan.days} gün)`,
            `Tutar: ${formatNacklAmount(notice.amountRaw)} NACKL`,
            `Bitiş: ${new Date(notice.activeUntil).toLocaleString("tr-TR")}`,
            "",
            "Madenciliği başlatmak için: /miner_start",
          ].join("\n"),
        );
      } catch (error) {
        console.error("NACKL payments: activation notice failed:", {
          chatId: notice.chatId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (credited) console.log("NACKL payments check finished:", { credited });
  } finally {
    nacklPaymentsRunning = false;
  }
}

function startNacklPaymentsScheduler(bot: Telegraf<any>) {
  if (!NACKL_PAYMENTS_CHECK_ENABLED) {
    console.log(
      "NACKL payments scheduler disabled (NACKL_PAYMENTS_CHECK_ENABLED / wallet)",
    );
    return false;
  }

  if (nacklPaymentsTimer) clearTimeout(nacklPaymentsTimer);

  const scheduleNext = (delayMs: number) => {
    nacklPaymentsTimer = setTimeout(() => {
      void runNacklPaymentsCheckTick(bot).finally(() =>
        scheduleNext(NACKL_PAYMENTS_CHECK_INTERVAL_MS),
      );
    }, delayMs);
  };

  console.log("NACKL payments scheduler started:", {
    intervalSeconds: Math.round(NACKL_PAYMENTS_CHECK_INTERVAL_MS / 1000),
    wallet: NACKL_PAYMENTS_WALLET_NAME,
  });
  scheduleNext(2000);
}

let paymentsCheckTimer: ReturnType<typeof setTimeout> | undefined;
let paymentsCheckRunning = false;

function findInvoiceCombinationMatchingAmount(
  invoices: PendingInvoice[],
  targetRaw: bigint,
  maxCombinationSize = 3,
): PendingInvoice[] | null {
  const n = invoices.length;

  for (let size = 1; size <= Math.min(maxCombinationSize, n); size += 1) {
    const combo: number[] = [];

    const search = (start: number): PendingInvoice[] | null => {
      if (combo.length === size) {
        const sum = combo.reduce(
          (acc, idx) => acc + BigInt(invoices[idx]!.amountRaw),
          0n,
        );
        return sum === targetRaw ? combo.map((idx) => invoices[idx]!) : null;
      }

      for (let i = start; i < n; i += 1) {
        combo.push(i);
        const result = search(i + 1);
        if (result) return result;
        combo.pop();
      }

      return null;
    };

    const found = search(0);
    if (found) return found;
  }

  return null;
}

async function runPaymentsCheckTickSenderBased(
  bot: Telegraf<any>,
  state: PaymentsState,
  now: number,
): Promise<boolean> {
  // The underlying query is now schema-verified against mainnet (see the
  // notes on getIncomingShellTransfers). It can still throw on transport
  // errors or a resolver timeout, in which case the caller falls back to the
  // balance-diff approach.
  const transfers = await getIncomingShellTransfers(PAYMENTS_WALLET_NAME, 30);

  const seen = new Set(state.seenMessageIds);
  const newTransfers = transfers.filter((transfer) => !seen.has(transfer.id));

  if (!newTransfers.length) {
    return true;
  }

  const beeState = readBeeMinerState();

  for (const transfer of newTransfers) {
    seen.add(transfer.id);

    const srcNormalized = transfer.src.trim().toLowerCase();
    const ownerMiner = beeState.miners.find(
      (miner) =>
        miner.status === "active" &&
        (miner.minerAddress || "").trim().toLowerCase() === srcNormalized,
    );

    if (!ownerMiner) {
      console.log(
        "Payments check (sender-based): incoming SHELL from an unrecognized wallet (no matching connected miner):",
        { src: transfer.src, shell: formatShellAmount(transfer.shellValueRaw) },
      );
      continue;
    }

    const chatId = ownerMiner.chatId;
    const candidateInvoices = state.pendingInvoices.filter(
      (invoice) =>
        invoice.chatId === chatId &&
        (!invoice.currency || invoice.currency === "shell") &&
        new Date(invoice.expiresAt).getTime() > now,
    );

    // Each invoice has a distinct fractional amount. Match exactly rather than
    // treating an overpayment as the cheapest open invoice; otherwise someone
    // with more than one pending plan could receive credit for the wrong one.
    const exactMatches = candidateInvoices.filter(
      (invoice) => BigInt(transfer.shellValueRaw) === BigInt(invoice.amountRaw),
    );
    const matchedInvoice =
      exactMatches.length === 1 ? exactMatches.at(0) ?? null : null;

    if (!matchedInvoice) {
      console.log(
        "Payments check (sender-based): recognized wallet paid but no unique exact invoice match:",
        {
          chatId,
          src: transfer.src,
          shell: formatShellAmount(transfer.shellValueRaw),
          exactMatchCount: exactMatches.length,
        },
      );
      continue;
    }

    const plan = getPlanById(matchedInvoice.planId);
    if (!plan) continue;

    const activeUntil = grantSubscription(
      state,
      chatId,
      plan.id,
      plan.days,
      {
        paid: true,
        paymentSource: "shell",
      },
    );
    state.pendingInvoices = state.pendingInvoices.filter(
      (item) => item.id !== matchedInvoice.id,
    );
    appendPaymentHistory(state, {
      id: `shell:${transfer.id}`,
      status: "confirmed",
      source: "shell",
      chatId,
      planId: plan.id,
      invoiceId: matchedInvoice.id,
      amountRaw: transfer.shellValueRaw,
      currency: "shell",
      transactionId: transfer.id,
      senderAddress: transfer.src,
      invoiceCreatedAt: matchedInvoice.createdAt,
      recordedAt: new Date().toISOString(),
      activeUntil,
    });

    console.log("Payments check (sender-based): matched invoice:", {
      chatId,
      plan: plan.id,
      wallet: ownerMiner.walletName,
    });

    try {
      await bot.telegram.sendMessage(
        chatId,
        [
          `✅ Ödemen alındı! ${plan.label} planı aktif.`,
          `Bitiş: ${new Date(activeUntil).toLocaleString("tr-TR")}`,
        ].join("\n"),
      );
    } catch (notifyError) {
      console.error("Payments: activation notify failed:", {
        chatId,
        message: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }
  }

  // Cap how many message ids we remember so this file doesn't grow forever.
  state.seenMessageIds = Array.from(seen).slice(-500);

  return true;
}

async function runPaymentsCheckTickBalanceDiff(
  bot: Telegraf<any>,
  state: PaymentsState,
  now: number,
): Promise<void> {
  let currentBalanceRaw: string;

  try {
    const balanceInfo = await getShellBalance(PAYMENTS_WALLET_NAME);
    currentBalanceRaw = balanceInfo.shellBalanceRaw;
  } catch (error) {
    console.error("Payments check: failed to read wallet balance:", {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (state.lastCheckedBalanceRaw === null) {
    // First run — establish a baseline only, don't try to match against
    // whatever the wallet's balance happens to already be.
    state.lastCheckedBalanceRaw = currentBalanceRaw;
    return;
  }

  const delta = BigInt(currentBalanceRaw) - BigInt(state.lastCheckedBalanceRaw);

  const shellInvoices = state.pendingInvoices.filter(
    (invoice) => !invoice.currency || invoice.currency === "shell",
  );

  if (delta > 0n && shellInvoices.length) {
    let matched = findInvoiceCombinationMatchingAmount(shellInvoices, delta);

    if (!matched) {
      // Fix: safe fallback for a slight typo (e.g. last digit off) — only
      // applies when exactly ONE pending invoice is within a small
      // tolerance of the observed delta, so there's no ambiguity about
      // which invoice it belongs to.
      const TOLERANCE_RAW = 10n ** BigInt(SHELL_DECIMALS - 2); // 0.01 SHELL
      const closeMatches = shellInvoices.filter((invoice) => {
        const diff = BigInt(invoice.amountRaw) - delta;
        return (diff < 0n ? -diff : diff) <= TOLERANCE_RAW;
      });

      if (closeMatches.length === 1) {
        matched = closeMatches;
        console.log("Payments check: matched via tolerance fallback:", {
          invoiceId: closeMatches[0]!.id,
        });
      }
    }

    if (matched) {
      for (const invoice of matched) {
        const plan = resolvePaidPlan(invoice.planId);

        if (!plan) continue;

        const activeUntil = grantSubscription(
          state,
          invoice.chatId,
          plan.id,
          plan.days,
          {
            paid: true,
            paymentSource: "shell",
          },
        );

        state.pendingInvoices = state.pendingInvoices.filter(
          (item) => item.id !== invoice.id,
        );
        appendPaymentHistory(state, {
          id: `shell-balance:${invoice.id}:${now}`,
          status: "confirmed",
          source: "shell",
          chatId: invoice.chatId,
          planId: plan.id,
          invoiceId: invoice.id,
          amountRaw: invoice.amountRaw,
          currency: "shell",
          transactionId: null,
          senderAddress: null,
          invoiceCreatedAt: invoice.createdAt,
          recordedAt: new Date().toISOString(),
          activeUntil,
          note: "Toplam cüzdan bakiyesi farkından eşleştirildi",
        });

        try {
          await bot.telegram.sendMessage(
            invoice.chatId,
            [
              `✅ Ödemen alındı! ${plan.label} planı aktif.`,
              `Bitiş: ${new Date(activeUntil).toLocaleString("tr-TR")}`,
            ].join("\n"),
          );
        } catch (notifyError) {
          console.error("Payments: activation notify failed:", {
            chatId: invoice.chatId,
            message:
              notifyError instanceof Error
                ? notifyError.message
                : String(notifyError),
          });
        }
      }

      console.log("Payments check: matched invoice(s):", {
        count: matched.length,
        deltaShell: formatShellAmount(delta.toString()),
      });
    } else {
      // Fix: don't silently drop unexplained incoming funds — flag them
      // for manual admin reconciliation instead of guessing.
      console.log(
        "Payments check: unmatched incoming balance delta (needs manual review):",
        { deltaShell: formatShellAmount(delta.toString()) },
      );
    }
  }

  state.lastCheckedBalanceRaw = currentBalanceRaw;
}

async function runPaymentsCheckTick(bot: Telegraf<any>) {
  if (paymentsCheckRunning || beeIsChainCritical()) return;

  paymentsCheckRunning = true;

  try {
    const state = readPaymentsState();
    const now = Date.now();

    // Drop expired, never-paid invoices so they stop being candidates for
    // matching (and stop cluttering the pending list).
    state.pendingInvoices = state.pendingInvoices.filter(
      (invoice) => new Date(invoice.expiresAt).getTime() > now,
    );

    // Fix: prefer sender-based matching (who sent it, matched against their
    // connected mining wallet) — no fractional-amount trick needed, and
    // matches how competitors like MinerGO do it ("only registered wallets
    // can top up"). The query behind it is schema-verified against mainnet;
    // the balance-diff + unique-amount path stays as a fallback for transport
    // errors and resolver timeouts.
    try {
      await runPaymentsCheckTickSenderBased(bot, state, now);
    } catch (error) {
      console.error(
        "Payments check: sender-based method failed, falling back to balance-diff:",
        { message: error instanceof Error ? error.message : String(error) },
      );
      await runPaymentsCheckTickBalanceDiff(bot, state, now);
    }

    writePaymentsState(state);
  } finally {
    paymentsCheckRunning = false;
  }
}

function startPaymentsCheckScheduler(bot: Telegraf<any>) {
  if (!PAYMENTS_CHECK_ENABLED) {
    console.log("Payments check scheduler disabled by PAYMENTS_CHECK_ENABLED=false");
    return;
  }

  if (paymentsCheckTimer) {
    clearTimeout(paymentsCheckTimer);
  }

  const MIN_RESCHEDULE_FLOOR_MS = 1000;

  const scheduleAt = (targetMs: number) => {
    const delayMs = Math.max(0, targetMs - Date.now());
    paymentsCheckTimer = setTimeout(() => {
      void runPaymentsCheckTick(bot).finally(() => {
        const nextTarget = targetMs + PAYMENTS_CHECK_INTERVAL_MS;
        scheduleAt(Math.max(nextTarget, Date.now() + MIN_RESCHEDULE_FLOOR_MS));
      });
    }, delayMs);
  };

  console.log("Payments check scheduler started:", {
    intervalSeconds: Math.round(PAYMENTS_CHECK_INTERVAL_MS / 1000),
    wallet: PAYMENTS_WALLET_NAME,
  });

  scheduleAt(Date.now() + 15 * 1000);
}

function groupMiningWatchesByChat(watches: MiningWatchRecord[]) {
  const grouped = new Map<number, MiningWatchRecord[]>();

  for (const watch of watches) {
    const list = grouped.get(watch.chatId) || [];
    list.push(watch);
    grouped.set(watch.chatId, list);
  }

  return grouped;
}

async function runMiningSummaryPush(bot: Telegraf<any>, trigger = "auto") {
  const state = readMiningMonitorState();
  const watches = state.watches.filter((watch) =>
    isMiningWatchNotificationEnabled(watch),
  );
  const grouped = groupMiningWatchesByChat(watches);

  console.log("Mining summary push started:", {
    trigger,
    chats: grouped.size,
    watches: watches.length,
    at: new Date().toISOString(),
  });

  for (const [chatId] of grouped) {
    if (isChatBlocked(chatId)) {
      continue;
    }

    try {
      await sendMessageWithOptionalHtml(
        bot,
        chatId,
        buildMiningSummaryStatusMessage(chatId, { pushOnly: true }),
      );
    } catch (error) {
      noteNotificationFailure(chatId, error);
      console.error("Mining summary push send failed:", {
        chatId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function startMiningSummaryScheduler(bot: Telegraf<any>) {
  if (miningSummaryTimer) {
    clearTimeout(miningSummaryTimer);
  }

  const scheduleNext = (delayMs: number) => {
    miningSummaryTimer = setTimeout(() => {
      void runMiningSummaryPush(bot, "auto").finally(() => {
        scheduleNext(MINING_SUMMARY_INTERVAL_MS);
      });
    }, delayMs);
  };

  console.log("Mining summary scheduler started:", {
    intervalMinutes: MINING_SUMMARY_INTERVAL_MINUTES,
    firstPushMinutes: MINING_SUMMARY_INTERVAL_MINUTES,
  });

  scheduleNext(MINING_SUMMARY_INTERVAL_MS);
}

function buildPublicMonitorStatusMessage(chatId?: number) {
  return buildMiningSummaryStatusMessage(chatId);
}

function buildMonitorStatusMessage() {
  const state = readMiningMonitorState();

  return [
    "🩺 Wallet Scan Status",
    "",
    `Status: ${miningMonitorRuntime.startedAt ? "running" : "not started"}`,
    `Enabled: ${MINING_MONITOR_ENABLED ? "yes" : "no"}`,
    `Source: ${MINING_MONITOR_SOURCE_LABEL}`,
    `Interval: ${Math.round(MINING_MONITOR_INTERVAL_MS / 1000)}s`,
    `Tracked wallets: ${state.watches.length}`,
    `Next tick: ${miningMonitorRuntime.nextTickAt || "-"}`,
    `Tick running: ${miningMonitorRuntime.isTickRunning ? "yes" : "no"}`,
    `Last tick start: ${miningMonitorRuntime.lastTickStartedAt || "-"}`,
    `Last tick finish: ${miningMonitorRuntime.lastTickFinishedAt || "-"}`,
    `Last trigger: ${miningMonitorRuntime.lastTickTrigger || "-"}`,
    `Last checked wallets: ${miningMonitorRuntime.lastTickWatchCount}`,
    `Last deltas: ${miningMonitorRuntime.lastTickChangedCount}`,
    `Last notifications: ${miningMonitorRuntime.lastTickNotifiedCount}`,
    `Last errors: ${miningMonitorRuntime.lastTickErrorCount}`,
    `Last error: ${miningMonitorRuntime.lastError || "-"}`,
  ].join("\n");
}
function extractCustomEmojiEntities(message: any) {
  const entities = Array.isArray(message?.entities) ? message.entities : [];
  return entities.filter(
    (entity: any) => entity?.type === "custom_emoji" && entity?.custom_emoji_id,
  );
}

function buildEmojiIdReply(message: any) {
  const ownEntities = extractCustomEmojiEntities(message);
  const replyEntities = extractCustomEmojiEntities(message?.reply_to_message);
  const entities = ownEntities.length ? ownEntities : replyEntities;

  if (!entities.length) {
    return [
      "🧩 Custom Emoji ID Reader",
      "",
      "Send the custom emoji with this command:",
      "/emoji_id 😊",
      "",
      "Or reply to a message containing the custom emoji with:",
      "/emoji_id",
      "",
      "Normal Unicode emojis do not have a custom emoji ID.",
    ].join("\n");
  }

  const lines = entities.map(
    (entity: any, index: number) => `${index + 1}. ${entity.custom_emoji_id}`,
  );

  return [
    "🧩 Custom Emoji IDs",
    "",
    ...lines,
    "",
    "Use in .env:",
    "NACKL_CUSTOM_EMOJI_ID=<id>",
    "USDC_CUSTOM_EMOJI_ID=<id>",
  ].join("\n");
}

async function replyEmojiId(ctx: any) {
  if (!isAdminContext(ctx)) {
    await replyAdminOnly(ctx);
    return;
  }

  await ctx.reply(buildEmojiIdReply(ctx.message));
}

function formatDebugText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "-";
}

function formatDebugUnixTime(value?: number | null) {
  if (!value) return "-";
  return `${formatUnixDate(value)} / ${formatTimeAgo(value)}`;
}

function buildDebugPopitMessage(
  debug: Awaited<ReturnType<typeof getAckiPopitDebug>>,
) {
  const lockedRaw = getNacklRaw(debug.lockedTokens);
  const rewardsRaw = debug.decodedState?.rewards || null;

  return [
    "🧪 PopitGame Debug",
    "",
    `Input: ${formatDebugText(debug.input)}`,
    `Name: ${formatDebugText(debug.name)}`,
    `Indexer: ${formatDebugText(debug.indexerAddress)}`,
    `Wallet: ${formatDebugText(debug.walletAddress)}`,
    "",
    `PopitGame: ${formatDebugText(debug.popitGameAddress)}`,
    `Popit accountId: ${formatDebugText(debug.popitGameAccountId)}`,
    `Popit dappId: ${formatDebugText(debug.popitGameDappId)}`,
    `Popit code_hash: ${formatDebugText(debug.popitGameCodeHash)}`,
    "",
    `Locked NACKL raw: ${formatDebugText(lockedRaw)}`,
    `Locked NACKL: ${formatRawNackl(lockedRaw)}`,
    `MBI _mbiCur: ${formatDebugText(debug.decodedState?.mbiCur || debug.mamaboardLevel)}`,
    `Rewards _rewards raw: ${formatDebugText(rewardsRaw)}`,
    `Rewards _rewards / 1e9: ${rewardsRaw ? formatRawNackl(rewardsRaw) : "-"}`,
    `Start _startTime: ${formatDebugText(debug.decodedState?.startTime)}`,
    `Boost _boost: ${formatDebugText(debug.decodedState?.boost)}`,
    "",
    `Last paid: ${formatDebugUnixTime(debug.lastPaid)}`,
    `Last transaction lt: ${formatDebugText(debug.lastTransactionLt)}`,
    `Updated: ${formatDebugText(debug.updatedAt)}`,
    `Cached: ${debug.cached ? "yes" : "no"}`,
    "",
    "Note: _rewards is shown for verification; it is not labeled as Total taps yet.",
  ].join("\n");
}

async function replyDebugPopit(ctx: any) {
  if (!isAdminContext(ctx)) {
    await replyAdminOnly(ctx);
    return;
  }

  const input = normalizeMiningInput(getCommandArgument(ctx.message?.text));

  if (!input) {
    await ctx.reply(
      [
        "Usage: /debug_popit <name/address>",
        "",
        "Example:",
        "/debug_popit ackerman",
      ].join("\n"),
    );
    return false;
  }

  try {
    const debug = await getAckiPopitDebug(input);
    await ctx.reply(buildDebugPopitMessage(debug));
  } catch (error) {
    console.error(
      "Popit debug failed:",
      error instanceof Error ? error.message : String(error),
    );
    await ctx.reply("Popit debug bilgisi alınamadı.");
  }
}

function buildDebugTokensMessage(
  wallet: Awaited<ReturnType<typeof getAckiWalletActivity>>,
) {
  const tokenLines = wallet.tokens.length
    ? wallet.tokens.map(
        (token) =>
          `currency ${token.currency} ${token.symbol}: ${formatCompactAmount(token.balanceFormatted)} | raw ${token.balanceRaw}`,
      )
    : ["-"];

  const displayShell = getTokenAmount(wallet.tokens, "SHELL");

  return [
    "🧪 Token Debug",
    "",
    `Input: ${formatDebugText(wallet.input)}`,
    `Name: ${formatDebugText(wallet.name)}`,
    `Wallet: ${formatDebugText(wallet.address)}`,
    "",
    "Native balance:",
    `${formatCompactAmount(wallet.nativeBalanceFormatted || "0")} | raw ${formatDebugText(wallet.balanceRaw)}`,
    "",
    "balance_other tokens:",
    ...tokenLines,
    "",
    "Display mapping:",
    `SHELL line source: balance_other currency 2`,
    `SHELL line value: ${displayShell}`,
    "Native balance is not used for the SHELL line.",
    "",
    `Updated: ${formatDebugText(wallet.updatedAt)}`,
    `Cached: ${wallet.cached ? "yes" : "no"}`,
  ].join("\n");
}

async function replyDebugTokens(ctx: any) {
  if (!isAdminContext(ctx)) {
    await replyAdminOnly(ctx);
    return;
  }

  const input = normalizeMiningInput(getCommandArgument(ctx.message?.text));

  if (!input) {
    await ctx.reply(
      [
        "Usage: /debug_tokens <name/address>",
        "",
        "Example:",
        "/debug_tokens ackerman",
      ].join("\n"),
    );
    return;
  }

  try {
    const wallet = await getAckiWalletActivity(input);
    await ctx.reply(buildDebugTokensMessage(wallet));
  } catch (error) {
    console.error(
      "Token debug failed:",
      error instanceof Error ? error.message : String(error),
    );
    await ctx.reply("Token debug bilgisi alınamadı.");
  }
}

// Fix: MiningHub debug command removed along with the mininghub data source.
// Use /debug_popit for mainnet-GraphQL-backed wallet/PopitGame debugging.

async function replyProfile(ctx: any) {
  const user = findUserByTelegramId(ctx.from.id);

  if (!user) {
    await ctx.reply("Önce /start yazarak kayıt olmalısın.");
    return;
  }

  await ctx.reply(
    [
      "👤 Profil",
      "",
      `İsim: ${user.firstName}`,
      `Telegram ID: ${user.telegramId}`,
      `Kullanıcı adı: ${user.username ? "@" + user.username : "-"}`,
      `Puan: ${user.points}`,
      `Referans kodu: ${user.referralCode}`,
      `Son claim: ${user.lastClaimDate || "-"}`,
      `Mining başlangıç: ${user.miningStartedAt ? "Aktif" : "Henüz başlamadı"}`,
    ].join("\n"),
  );
}

async function replyReferral(ctx: any) {
  const user = findUserByTelegramId(ctx.from.id);

  if (!user) {
    await ctx.reply("Önce /start yazarak kayıt olmalısın.");
    return;
  }

  const me = await ctx.telegram.getMe();
  const referralLink = `https://t.me/${me.username}?start=${user.referralCode}`;

  await ctx.reply(
    [
      "🔗 Referans Linkin",
      "",
      referralLink,
      "",
      "Bu linkle gelen her yeni kullanıcı için +50 test puanı kazanırsın.",
    ].join("\n"),
  );
}

async function replyClaim(ctx: any) {
  const users = readUsers();
  const user = users.find((item) => item.telegramId === ctx.from.id);

  if (!user) {
    await ctx.reply("Önce /start yazarak kayıt olmalısın.");
    return;
  }

  const today = getIstanbulDateKey();

  if (user.lastClaimDate === today) {
    await ctx.reply(
      [
        "🎁 Günlük claim zaten alındı.",
        "",
        `Bugünkü tarih: ${today}`,
        `Mevcut puanın: ${user.points}`,
        "",
        "Yarın tekrar claim yapabilirsin.",
      ].join("\n"),
    );
    return;
  }

  user.lastClaimDate = today;
  user.points += 100;

  writeUsers(users);

  await ctx.reply(
    [
      "🎁 Günlük claim başarılı ✅",
      "",
      "+100 test puanı eklendi.",
      `Toplam puanın: ${user.points}`,
    ].join("\n"),
  );
}

async function replyLeaderboard(ctx: any) {
  const users = readUsers();

  if (users.length === 0) {
    await ctx.reply("Henüz kullanıcı yok.");
    return;
  }

  const topUsers = [...users].sort((a, b) => b.points - a.points).slice(0, 10);

  const lines = topUsers.map((user, index) => {
    const rank = index + 1;
    return `${rank}. ${getUserDisplayName(user)} — ${user.points} puan`;
  });

  await ctx.reply(["🏆 Liderlik Tablosu", "", ...lines].join("\n"));
}
async function replyTasks(ctx: any) {
  const user = findUserByTelegramId(ctx.from.id);

  if (!user) {
    await ctx.reply("Önce /start yazarak kayıt olmalısın.");
    return;
  }

  const completedTasks = user.completedTasks || [];

  const taskLines = TASKS.map((task, index) => {
    const isCompleted = completedTasks.includes(task.id);
    const status = isCompleted ? "✅" : "⏳";
    return `${index + 1}. ${status} ${task.title} — +${task.reward} puan`;
  });

  const buttons = TASKS.map((task) => {
    const isCompleted = completedTasks.includes(task.id);

    return [
      Markup.button.callback(
        isCompleted ? `✅ ${task.title}` : `Tamamla: ${task.title}`,
        `complete_task:${task.id}`,
      ),
    ];
  });

  await ctx.reply(
    [
      "📋 Görevler",
      "",
      ...taskLines,
      "",
      "Tamamlamak istediğin görevin butonuna bas.",
    ].join("\n"),
    Markup.inlineKeyboard(buttons),
  );
}

async function completeTask(ctx: any, taskId: string) {
  const users = readUsers();
  const user = users.find((item) => item.telegramId === ctx.from.id);

  if (!user) {
    await ctx.reply("Önce /start yazarak kayıt olmalısın.");
    return;
  }

  const task = TASKS.find((item) => item.id === taskId);

  if (!task) {
    await ctx.reply("Görev bulunamadı.");
    return;
  }

  if (!user.completedTasks) {
    user.completedTasks = [];
  }

  if (user.completedTasks.includes(task.id)) {
    await ctx.reply(
      [
        "Bu görev zaten tamamlandı ✅",
        "",
        `Görev: ${task.title}`,
        `Mevcut puanın: ${user.points}`,
      ].join("\n"),
    );
    return;
  }

  user.completedTasks.push(task.id);
  user.points += task.reward;

  writeUsers(users);

  await ctx.reply(
    [
      "Görev tamamlandı ✅",
      "",
      `Görev: ${task.title}`,
      `Kazanç: +${task.reward} puan`,
      `Toplam puanın: ${user.points}`,
    ].join("\n"),
  );
}
async function replyMining(ctx: any) {
  const users = readUsers();
  const user = users.find((item) => item.telegramId === ctx.from.id);

  if (!user) {
    await ctx.reply("Önce /start yazarak kayıt olmalısın.");
    return;
  }

  if (!user.miningStartedAt) {
    user.miningStartedAt = new Date().toISOString();
    user.points += 25;
    writeUsers(users);

    await ctx.reply(
      [
        "⛏️ Mining simülasyonu başlatıldı ✅",
        "",
        "Bu gerçek Bee Engine entegrasyonu değildir.",
        "Şimdilik öğrenme amaçlı test mining sistemidir.",
        "",
        "+25 başlangıç puanı eklendi.",
        `Toplam puanın: ${user.points}`,
      ].join("\n"),
    );

    return;
  }

  const startedAt = new Date(user.miningStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - startedAt.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 1000 / 60));

  const simulatedPower = Math.min(100, 10 + Math.floor(diffMinutes / 3));
  const simulatedHash = diffMinutes * 7;

  await ctx.reply(
    [
      "⛏️ Mining Durumu",
      "",
      "Durum: Aktif ✅",
      `Çalışma süresi: ${diffMinutes} dakika`,
      `Simüle güç: %${simulatedPower}`,
      `Simüle katkı: ${simulatedHash} hash`,
      "",
      "Not: Bee Engine entegrasyonu sonraki aşamada bağlanacak.",
    ].join("\n"),
  );
}

export async function startBot(botToken: string) {
  const bot = new Telegraf(botToken);
  botInstance = bot;

  // Fix: the bot was responding to every command — and the mining monitor
  // was sending reward notifications — inside any group/channel it got added
  // to. Now group/channel chats only get /info (+ its /wallet alias) and
  // /help; everything else there is silently ignored (no reply at all, per
  // request — not even a "DM only" redirect). Private chats are completely
  // unaffected.
  const GROUP_ALLOWED_COMMANDS = new Set(["info", "wallet", "help"]);

  bot.use(async (ctx, next) => {
    const chatType = ctx.chat?.type;

    if (chatType && chatType !== "private") {
      const messageText =
        ctx.message && "text" in ctx.message && typeof ctx.message.text === "string"
          ? ctx.message.text
          : "";
      const commandMatch = messageText.match(/^\/([a-zA-Z0-9_]+)/);
      const commandName = commandMatch
        ? commandMatch[1]!.split("@")[0]!.toLowerCase()
        : null;

      if (commandName && GROUP_ALLOWED_COMMANDS.has(commandName)) {
        return next();
      }

      return;
    }

    return next();
  });

  bot.start(async (ctx) => {
    const from = ctx.from;

    if (!from) {
      await ctx.reply("Kullanıcı bilgisi alınamadı.");
      return;
    }

    const payload = getStartPayload(ctx.message.text);
    const referredBy = payload?.startsWith("bee_") ? payload : undefined;

    const result = registerOrGetUser({
      telegramId: from.id,
      firstName: from.first_name || "Kullanıcı",
      username: from.username,
      referredBy,
    });

    // Persistent bottom keyboard (the one behind the "Menü" button), not the
    // inline card: it stays put after every message, so the common actions are
    // always one tap away instead of being scrolled out of history.
    // Someone who blocked the bot and later pressed /start is reachable
    // again; clear the flag so scheduled pushes resume for them.
    unmarkChatBlocked(from.id);

    await ctx.reply(buildWelcomeMessage(from.language_code), buildMainKeyboard());
    await ctx.reply(buildHowToUseMessage(from.language_code));

    // Website search box deep link (ackinackiradar.com). Telegram caps
    // start payloads at 64 chars, [A-Za-z0-9_] only. A raw wallet address is
    // already 64 hex chars, so it leaves no room for any prefix — the site
    // passes it through bare. Wallet NAMES are much shorter but can contain
    // "-" (invalid in a payload), so those are sent as "info_" + hex(name).
    // Two distinct, unambiguous shapes; either decodes to the same lookup as
    // typing /info <input> by hand.
    if (payload && /^[0-9a-f]{64}$/i.test(payload)) {
      await sendSingleWalletInfo(ctx, payload);
    } else if (payload?.startsWith("info_")) {
      const hex = payload.slice("info_".length);
      if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0) {
        try {
          const decoded = Buffer.from(hex, "hex").toString("utf8");
          if (decoded.trim()) {
            await sendSingleWalletInfo(ctx, decoded.trim());
          }
        } catch {
          // Malformed payload — the welcome message above already covers it.
        }
      }
    }
  });

  bot.command("info", async (ctx) => replyWalletInfo(ctx));
  bot.command("wallet", async (ctx) => replyWalletInfo(ctx));
  bot.command("id", async (ctx) => {
    const chatId = ctx.chat?.id;

    // A group chat id is not a personal Telegram user id. Limit this command
    // to the private bot conversation so users never copy the wrong value.
    if (!chatId || ctx.chat?.type !== "private" || ctx.from?.id !== chatId) {
      await ctx.reply("Bu komutu botla olan özel sohbetinizde kullanın.");
      return;
    }

    await ctx.reply(
      `Telegram ID'niz: ${chatId}\n\nBu numarayı yalnızca yönetici yetkisi tanımlanması için paylaşın.`,
    );
  });
  bot.command("help", async (ctx) =>
    ctx.reply(buildHelpMessage(ctx.from?.language_code)),
  );
  // /watch, /mining, /unwatch, /wallets and /watchlist were removed on
  // 2026-08-09: reward notifications are off, so a user-managed watch list no
  // longer means anything.  Wallets now enter the scan set on their own, from
  // /info lookups and from cloud-mining connections.  The handlers and the
  // record shape are deliberately left in place so this can be restored.
  // --- Telegram Stars ---
  //
  // Stars need no payment provider: `currency: "XTR"` and provider_token must
  // be omitted completely. Sending an empty provider_token is accepted by
  // some Bot API versions but Telegram clients can then fail during top-up
  // with PROVIDER_ACCOUNT_INVALID. Telegraf 4.16.3 predates Stars, so the
  // values pass through via the cast below.
  bot.command("pay", async (ctx) => {
    const planId = getCommandArgument(ctx.message?.text).trim().toLowerCase();
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Sohbet bilgisi alınamadı.");
      return;
    }

    // The 1-star test plan is admin-only and never listed, so a real user can
    // neither see it nor buy a day of mining for one star.
    // isRealAdminContext, not isAdminContext: the 1-star plan has to stay
    // available while /testmode is on, since testing the payment flow as a
    // normal user is exactly what it is for.
    const plan =
      planId === TEST_PLAN.id && isRealAdminContext(ctx)
        ? TEST_PLAN
        : getPlanById(planId);

    if (!plan) {
      await ctx.reply(
        [
          "⭐ Pay with Telegram Stars",
          "",
          ...PLANS.map(
            (p) =>
              `/pay ${p.id} — ${p.days} days — ${getPlanStars(p)} ⭐ (${getPlanStarsPriceUsd(p)} USDT)`,
          ),
          "",
          `Want to try first? /trial (${TRIAL_DAYS} days, free)`,
        ].join("\n"),
      );
      return;
    }

    const stars = getPlanStars(plan);

    try {
      await (ctx as any).replyWithInvoice({
        title: `${plan.label} — ${plan.days} gün`,
        description: `Acki Nacki cloud mining for ${plan.days} days. Activates as soon as the payment clears.`,
        // Echoed back on successful_payment; this is how we know what was bought.
        payload: `plan:${plan.id}:${chatId}`,
        currency: "XTR",
        prices: [{ label: `${plan.label} ${plan.days} gün`, amount: stars }],
      });
      console.log("Stars invoice sent:", {
        chatId,
        plan: plan.id,
        stars,
      });
    } catch (error) {
      console.error("Stars invoice failed:", {
        chatId,
        plan: plan.id,
        message: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply(
        "Could not open the payment sheet. Try again shortly; contact the admin if it keeps failing.",
      );
    }
  });

  // Telegram Stars invoice payloads are bound to the account that created
  // them. Validate that binding plus the exact currency/amount before Telegram
  // is allowed to charge the user.
  function parseStarsInvoicePayload(payloadValue: unknown) {
    const parts = String(payloadValue || "").split(":");

    if (parts.length !== 3 || parts[0] !== "plan") {
      return null;
    }

    const plan = resolvePaidPlan(parts[1] || "");
    const intendedChatId = Number(parts[2]);

    if (
      !plan ||
      !Number.isSafeInteger(intendedChatId) ||
      intendedChatId <= 0
    ) {
      return null;
    }

    return { plan, intendedChatId };
  }

  bot.on("pre_checkout_query", async (ctx) => {
    const query = (ctx as any).preCheckoutQuery;
    const parsed = parseStarsInvoicePayload(query?.invoice_payload);
    const payerId = Number(query?.from?.id ?? ctx.from?.id ?? 0);

    if (
      !parsed ||
      !Number.isSafeInteger(payerId) ||
      parsed.intendedChatId !== payerId
    ) {
      console.warn("Stars pre-checkout account mismatch:", {
        payerId,
        payload: query?.invoice_payload,
      });

      await ctx.answerPreCheckoutQuery(
        false,
        "This invoice belongs to another account. Please create a new invoice.",
      );
      return;
    }

    const expectedStars = getPlanStars(parsed.plan);
    const currency = String(query?.currency || "");
    const totalAmount = Number(query?.total_amount);

    if (currency !== "XTR" || totalAmount !== expectedStars) {
      console.warn("Stars pre-checkout amount mismatch:", {
        chatId: payerId,
        plan: parsed.plan.id,
        currency,
        totalAmount,
        expectedStars,
      });

      await ctx.answerPreCheckoutQuery(
        false,
        "This invoice is no longer valid. Please create a new invoice.",
      );
      return;
    }

    await ctx.answerPreCheckoutQuery(true);
  });

  // Filtered rather than a bare bot.on("message"): that would sit in front of
  // every later command handler and only work because it called next().
  bot.on(message("successful_payment"), async (ctx) => {
    const payment = (ctx.message as any).successful_payment;
    const chatId = ctx.chat?.id;
    const chargeId = String(payment.telegram_payment_charge_id || "");
    const parsed = parseStarsInvoicePayload(payment.invoice_payload);

    if (
      !chatId ||
      !parsed ||
      parsed.intendedChatId !== chatId ||
      !chargeId
    ) {
      console.error("Stars payment with unusable identity/payload:", {
        chatId,
        payload: payment.invoice_payload,
        chargeIdPresent: Boolean(chargeId),
      });
      return;
    }

    const plan = parsed.plan;
    const expectedStars = getPlanStars(plan);
    const currency = String(payment.currency || "");
    const totalAmount = Number(payment.total_amount);

    if (currency !== "XTR" || totalAmount !== expectedStars) {
      console.error("Stars successful payment amount mismatch:", {
        chatId,
        plan: plan.id,
        currency,
        totalAmount,
        expectedStars,
        chargeId,
      });
      return;
    }

    const state = readPaymentsState();

    // Telegram can redeliver an update; crediting twice would be free time.
    if ((state.starsCharges ?? []).includes(chargeId)) {
      console.warn("Stars payment already credited, ignoring replay:", {
        chargeId,
      });
      return;
    }

    const activeUntil = grantSubscription(
      state,
      chatId,
      plan.id,
      plan.days,
      {
        paid: true,
        paymentSource: "stars",
      },
    );

    state.starsCharges = [
      ...(state.starsCharges ?? []),
      chargeId,
    ].slice(-500);
    appendPaymentHistory(state, {
      id: `stars:${chargeId}`,
      status: "confirmed",
      source: "stars",
      chatId,
      planId: plan.id,
      invoiceId: null,
      amountRaw: String(totalAmount),
      currency: "stars",
      transactionId: chargeId,
      senderAddress: null,
      invoiceCreatedAt: null,
      recordedAt: new Date().toISOString(),
      activeUntil,
    });

    writePaymentsState(state);

    console.log("Stars payment credited:", {
      chatId,
      plan: plan.id,
      stars: totalAmount,
      chargeId,
      activeUntil,
    });

    await ctx.reply(
      [
        "✅ Payment received — your subscription is active.",
        "",
        `Plan: ${plan.label} (${plan.days} days)`,
        `Paid: ${totalAmount} ⭐`,
        `Expires: ${new Date(activeUntil).toUTCString()}`,
        "",
        "Next: open the dashboard to connect a wallet and start mining.",
        "https://ackinackiradar.com",
      ].join("\n"),
    );
  });

  async function handleTrialRequest(ctx: any) {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Could not read chat info.");
      return;
    }

    const state = readPaymentsState();

    if ((state.trialUsed ?? []).includes(chatId)) {
      await ctx.reply("You have already used your free trial.");
      return;
    }

    const plan = PLANS[0]!;
    const activeUntil = grantSubscription(state, chatId, plan.id, TRIAL_DAYS, {
      trial: true,
    });
    state.trialUsed = [...(state.trialUsed ?? []), chatId];
    writePaymentsState(state);

    console.log("Trial granted:", { chatId, activeUntil });

    await ctx.reply(
      [
        `🎁 Your ${TRIAL_DAYS}-day free trial has started.`,
        "",
        `Expires: ${new Date(activeUntil).toUTCString()}`,
        "",
        "Now open the dashboard and connect your wallet:",
        "https://ackinackiradar.com",
        "",
        "1) Press “Telegram ile devam et” to sign in",
        "2) Enter your Acki Nacki wallet name and connect",
        "3) Approve in your wallet app, then press Check",
      ].join("\n"),
    );
  }

  bot.command("trial", handleTrialRequest);
  bot.hears(MENU_TRIAL, handleTrialRequest);

  // /wallets is the name people look for; /forget kept as an alias so anything
  // that already tells users to type it keeps working.
  // Radar watch records — distinct from the MINING wallets behind the
  // "👛 Wallets" keyboard button. Named apart on purpose: one "wallets" for two
  // different things was going to be read as a bug.
  // Suspends this admin's privileges so the operator can walk through the
  // product as a paying user would: subscription gate, one-wallet rule, the
  // lot. In memory only — a restart hands the privileges straight back.
  bot.command("testmode", async (ctx) => {
    if (!isRealAdminContext(ctx)) {
      await replyAdminOnly(ctx);
      return;
    }

    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Could not read chat info.");
      return;
    }

    const arg = getCommandArgument(ctx.message?.text).trim().toLowerCase();
    const turnOn = arg ? arg === "on" : !adminTestMode.has(chatId);

    if (turnOn) {
      adminTestMode.add(chatId);
    } else {
      adminTestMode.delete(chatId);
    }

    console.log("Admin test mode:", { chatId, testMode: turnOn });

    await ctx.reply(
      turnOn
        ? [
            "🧪 Test mode ON — you are now treated as a normal user.",
            "",
            "• Subscription is required to mine",
            "• One wallet per plan applies",
            "• Admin commands are refused",
            "",
            "/pay test (1 ⭐) still works, and /testmode off restores you.",
            "A restart also restores admin rights.",
          ].join("\n")
        : "✅ Test mode OFF — admin privileges restored.",
    );
  });

  bot.command("radar_wallets", replyForgetWallet);
  bot.command("forget", replyForgetWallet);

  // The counterpart to /miner_connect. /miner_stop only pauses; nothing until
  // now could delete the record, and it stores the mining secret key.
  bot.command("miner_remove", async (ctx) => {
    const chatId = ctx.chat?.id;
    const walletName = getCommandArgument(ctx.message?.text).trim();

    if (!chatId) {
      await ctx.reply("Could not read chat info.");
      return;
    }

    const state = readBeeMinerState();
    const owned = state.miners.filter((miner) => miner.chatId === chatId);

    if (!walletName) {
      await ctx.reply(
        [
          "Usage: /miner_remove <wallet name>",
          "",
          owned.length
            ? `Your wallets: ${owned.map((m) => m.walletName).join(", ")}`
            : "You have no connected wallet.",
        ].join("\n"),
      );
      return;
    }

    const record = owned.find(
      (miner) => miner.walletName.toLowerCase() === walletName.toLowerCase(),
    );

    if (!record) {
      await ctx.reply(`No connected wallet named "${walletName}".`);
      return;
    }

    // Discard the pooled instance while the keys are still readable, otherwise
    // a running session would outlive the record it belongs to.
    if (record.minerAddress) {
      beeDiscardMiner({
        appId: record.appId,
        minerAddress: record.minerAddress,
        publicKey: record.publicKey,
      });
    }

    state.miners = state.miners.filter((miner) => miner.id !== record.id);
    writeBeeMinerState(state);

    console.log("Miner removed via bot:", {
      chatId,
      walletName: record.walletName,
      previousStatus: record.status,
    });

    await ctx.reply(
      [
        `🗑️ ${record.walletName} removed.`,
        "",
        "Mining stopped and the stored keys were deleted.",
        "You can reconnect any time with /miner_connect.",
      ].join("\n"),
    );
  });
  bot.command("update", replyManualMiningUpdate);
  bot.command("mining_status", replyMiningStatus);
  bot.command("status", async (ctx) =>
    ctx.reply(buildMiningSummaryStatusMessage(ctx.chat?.id)),
  );
  bot.command("monitor_status", async (ctx) => {
    if (!isAdminContext(ctx)) {
      await ctx.reply(buildMiningSummaryStatusMessage(ctx.chat?.id));
      return;
    }

    await ctx.reply(buildMonitorStatusMessage());
  });
  bot.command("monitor_start", async (ctx) => {
    if (!isAdminContext(ctx)) {
      await replyAdminOnly(ctx);
      return;
    }

    if (!MINING_MONITOR_ENABLED) {
      await ctx.reply(
        "Mining monitor disabled by MINING_MONITOR_ENABLED=false.",
      );
      return;
    }

    startMiningMonitorScheduler(bot);
    if (MINING_SUMMARY_ENABLED) {
      startMiningSummaryScheduler(bot);
    }
    await ctx.reply(buildMonitorStatusMessage());
  });
  bot.command("cleanup_groups", async (ctx) => {
    if (!isAdminContext(ctx)) {
      await replyAdminOnly(ctx);
      return;
    }

    // Fix: some wallets were watched from inside a group/channel before the
    // private-chat-only restriction existed, so the monitor kept notifying
    // that group. Telegram group/supergroup/channel chat IDs are always
    // negative, private (user) chat IDs are always positive — that's used
    // here to find and remove the leftover group-registered watches.
    const state = readMiningMonitorState();
    const removed = state.watches.filter((watch) => watch.chatId < 0);

    if (!removed.length) {
      await ctx.reply("Gruptan/kanaldan eklenmiş izleme bulunamadı, temizlenecek bir şey yok.");
      return;
    }

    state.watches = state.watches.filter((watch) => watch.chatId >= 0);
    writeMiningMonitorState(state);

    const summary = removed
      .map((watch) => `- ${watch.label || watch.input} (chatId: ${watch.chatId})`)
      .join("\n");

    await ctx.reply(
      [
        `${removed.length} adet grup/kanal kaynaklı izleme kaldırıldı:`,
        "",
        summary,
      ].join("\n"),
    );
  });
  bot.command("broadcast", async (ctx) => {
    if (!isAdminContext(ctx)) {
      await replyAdminOnly(ctx);
      return;
    }

    // Fix: getCommandArgument() collapses newlines into single spaces, which
    // would ruin a multi-line broadcast message. This preserves the raw text
    // after the command instead.
    const rawText = String(ctx.message?.text || "");
    const message = rawText.replace(/^\/broadcast(@\S+)?\s?/, "");

    if (!message.trim()) {
      await ctx.reply(
        [
          "Kullanım: /broadcast <mesaj>",
          "",
          "Mesaj, en az bir cüzdan izleyen (bilinen) her sohbete gönderilir.",
          "Not: mesaja bir link (örn. https://ackinackiradar.com) eklersen,",
          "Telegram otomatik olarak sitenin önizleme kartını (logo + başlık +",
          "açıklama) gösterir — ayrıca fotoğraf eklemene gerek yok.",
        ].join("\n"),
      );
      return;
    }

    const state = readMiningMonitorState();
    const uniqueChatIds = Array.from(new Set(state.watches.map((watch) => watch.chatId)));

    await ctx.reply(`Yayın başlıyor: ${uniqueChatIds.length} sohbete gönderilecek...`);

    let sent = 0;
    let failed = 0;

    for (const chatId of uniqueChatIds) {
      try {
        await bot.telegram.sendMessage(chatId, message);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error("Broadcast send failed:", {
          chatId,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Fix: small delay between sends to stay comfortably under Telegram's
      // outbound rate limits when broadcasting to many chats at once.
      await sleep(50);
    }

    await ctx.reply(`Yayın tamamlandı: ${sent} gönderildi, ${failed} başarısız.`);
  });
  bot.command("broadcast_all", async (ctx) => {
    if (!isAdminContext(ctx)) {
      await replyAdminOnly(ctx);
      return;
    }

    // Fix: /broadcast only reaches wallet watchers (mining-monitor.json).
    // This variant reaches EVERYONE who has ever run /start — every /start
    // registers the user in data/users.json via registerOrGetUser(), so
    // that file is the actual full user registry, wallet-watcher or not.
    const rawText = String(ctx.message?.text || "");
    const body = rawText.replace(/^\/broadcast_all(@\S+)?\s?/, "");
    // Optional leading "photo:<url>" turns the broadcast into an image post.
    // Deliberately inline rather than an env var: a leftover env setting would
    // silently attach the image to every later broadcast too.
    const photoMatch = body.match(/^photo:(\S+)\s*/);
    const photoUrl = photoMatch ? photoMatch[1] : null;
    const message = photoMatch ? body.slice(photoMatch[0].length) : body;

    if (!message.trim()) {
      await ctx.reply(
        [
          "Kullanım: /broadcast_all [photo:<url>] <mesaj>",
          "",
          "Mesaj, botu en az bir kez /start ile başlatmış HERKESE gönderilir",
          "(sadece cüzdan izleyenlere değil).",
          "Not: mesaja bir link (örn. https://ackinackiradar.com) eklersen,",
          "Telegram otomatik olarak sitenin önizleme kartını gösterir.",
          "",
          "Görselli yayın için başa photo: ekle, örn.",
          "/broadcast_all photo:https://ackinackiradar.com/duyuru.png Mesaj...",
        ].join("\n"),
      );
      return;
    }

    const users = readUsers();
    const uniqueChatIds = Array.from(new Set(users.map((user) => user.telegramId)));

    // Telegram caps a photo caption at 1024 chars but a plain message at 4096.
    // A trilingual announcement can cross that line, so fall back to sending
    // the image and the text as two messages instead of losing the tail.
    const captionFits = message.length <= 1024;

    await ctx.reply(
      [
        `Yayın başlıyor: ${uniqueChatIds.length} kullanıcıya gönderilecek...`,
        photoUrl ? `Görsel: ${photoUrl}` : "Görsel yok (düz metin).",
        photoUrl && !captionFits
          ? `Mesaj ${message.length} karakter — başlık sınırını (1024) aştığı için görsel ve metin ayrı gönderilecek.`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    let sent = 0;
    let failed = 0;

    for (const chatId of uniqueChatIds) {
      try {
        if (photoUrl && captionFits) {
          await bot.telegram.sendPhoto(chatId, photoUrl, { caption: message });
        } else if (photoUrl) {
          await bot.telegram.sendPhoto(chatId, photoUrl);
          await bot.telegram.sendMessage(chatId, message);
        } else {
          await bot.telegram.sendMessage(chatId, message);
        }

        sent += 1;
      } catch (error) {
        failed += 1;
        noteNotificationFailure(chatId, error);
        console.error("Broadcast (all) send failed:", {
          chatId,
          hasPhoto: Boolean(photoUrl),
          message: error instanceof Error ? error.message : String(error),
        });
      }

      await sleep(50);
    }

    await ctx.reply(`Yayın tamamlandı: ${sent} gönderildi, ${failed} başarısız.`);
  });
  // Shared by /miner_connect and by the "Add wallet" button's force_reply, so
  // the button flow and the typed command cannot drift apart.
  async function startWalletConnect(ctx: any, walletName: string) {
    if (!walletName) {
      await ctx.reply(
        [
          "Usage: /miner_connect <wallet name>",
          "",
          "Example: /miner_connect ackerman",
        ].join("\n"),
      );
      return;
    }

    if (!BEE_APP_ID) {
      await ctx.reply(
        "Bulut madenciliği henüz aktif değil (BEE_APP_ID ayarlanmamış). Yönetici ile iletişime geçin.",
      );
      return;
    }

    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Sohbet bilgisi alınamadı.");
      return;
    }

    if (
      !isAdminChatId(chatId) &&
      !hasActiveSubscriptionForChat(readPaymentsState(), chatId)
    ) {
      await ctx.reply(
        [
          "💎 Aktif bir bulut madenciliği aboneliğin yok.",
          "",
          `Önce ${TRIAL_DAYS} günlük ücretsiz denemeyi kullanabilir veya bir plan satın alabilirsin.`,
          "",
          "Planlar: /plans",
          `Ücretsiz deneme: /trial`,
        ].join("\n"),
      );
      return;
    }

    try {
      const state = readBeeMinerState();
      const id = `${chatId}:${walletName}`;
      const existingIndex = state.miners.findIndex((m) => m.id === id);
      const existing = existingIndex >= 0 ? state.miners[existingIndex] : undefined;

      // Hand back the pending connection rather than minting a new keypair.
      // Connecting twice used to replace the keys, which invalidated an
      // approval already on its way to the chain — the wallet could then never
      // finish connecting. Same trap the dashboard had.
      const pendingLink =
        existing && existing.status === "pending_authorization"
          ? (existing as any).deepLink
          : null;

      if (pendingLink) {
        await ctx.reply(
          [
            `⛏️ ${walletName} is already waiting for approval.`,
            "",
            "Open the same link again and approve it:",
            pendingLink,
            "",
            "Then press the button below.",
          ].join("\n"),
          Markup.inlineKeyboard([
            [Markup.button.callback("✅ I approved it", `mn:chk:${walletName}`)],
          ]),
        );
        return;
      }

      const keys = await beeGenerateMiningKeys(BEE_APP_ID);
      const minerAddress = await beeResolveMinerAddress({
        appId: BEE_APP_ID,
        walletName,
      });

      const record: BeeMinerRecord = {
        id,
        chatId,
        walletName,
        appId: BEE_APP_ID,
        publicKey: keys.publicKey,
        secretKey: keys.secretKey,
        minerAddress,
        status: "pending_authorization",
        lastError: null,
        lastSessionStartedAt: null,
        lastSessionAt: null,
        lastTapsSent: null,
        lastRewardAt: null,
        createdAt: new Date().toISOString(),
        // Kept so a repeated connect can re-show this exact link.
        deepLink: keys.deepLink,
      } as BeeMinerRecord;

      if (existingIndex >= 0) {
        state.miners[existingIndex] = record;
      } else {
        state.miners.push(record);
      }

      writeBeeMinerState(state);

      // AN Wallet only exists on mobile, so tapping the link does nothing
      // when this chat is open on desktop Telegram — there is no app on that
      // machine to catch it. The approval step has to happen on the phone
      // either way; a QR code is what actually makes that practical from a
      // PC, same fix already shipped on the web dashboard.
      try {
        const qrBuffer = makeQrGifBuffer(keys.deepLink);

        if (qrBuffer) {
          await ctx.replyWithDocument(
            { source: qrBuffer, filename: "miner-connect.gif" },
            { caption: "📱 PC'den mi yazıyorsun? Bunu telefonunla tarat." },
          );
        }
      } catch (qrError) {
        // A QR image is a convenience, not the actual mechanism — the text
        // reply below with the raw link always follows regardless.
        console.error("miner_connect QR generation failed:", {
          walletName,
          message: qrError instanceof Error ? qrError.message : String(qrError),
        });
      }

      await ctx.reply(
        [
          `⛏️ Mining key created for ${walletName}.`,
          "",
          "1. Open this link (it launches your AN Wallet app):",
          keys.deepLink,
          "",
          "2. Approve it in AN Wallet.",
          "3. Then press the button below.",
        ].join("\n"),
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ I approved it", `mn:chk:${walletName}`)],
        ]),
      );
    } catch (error) {
      console.error("miner_connect failed:", {
        walletName,
        message: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply("Could not start the connection. Please try again.");
    }
  }

  bot.command("miner_connect", async (ctx) =>
    startWalletConnect(ctx, getCommandArgument(ctx.message?.text)),
  );

  // Shared by /miner_check and the "I approved it" button. Checks every pending
  // connection for the chat, so the button does not need to say which one.
  async function runMinerCheck(ctx: any) {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Could not read chat info.");
      return;
    }

    if (
      !isAdminChatId(chatId) &&
      !hasActiveSubscriptionForChat(readPaymentsState(), chatId)
    ) {
      await ctx.reply(
        [
          "💎 Aktif bir bulut madenciliği aboneliğin yok.",
          "",
          `Önce ${TRIAL_DAYS} günlük ücretsiz denemeyi kullanabilir veya bir plan satın alabilirsin.`,
          "",
          "Planlar: /plans",
          `Ücretsiz deneme: /trial`,
        ].join("\n"),
      );
      return;
    }

    const state = readBeeMinerState();
    const pending = state.miners.filter(
      (m) => m.chatId === chatId && m.status === "pending_authorization",
    );

    if (!pending.length) {
      await ctx.reply("No connection is waiting for approval. Use “Add wallet” first.");
      return;
    }

    // Propagation polling can now take up to ~36s, so say something first
    // instead of leaving the chat silent long enough to look broken.
    await ctx.reply("🔄 Zincir üzerinde kontrol ediliyor, bu bir dakikaya kadar sürebilir...");

    for (const record of pending) {
      try {
        if (!record.minerAddress) {
          throw new Error("MINER_ADDRESS_MISSING");
        }

        // 3 attempts (3s) was far too short: the wallet writes the key on
        // chain and it has to propagate before the Miner contract reports it,
        // which routinely takes longer than that. Every real approval failed
        // here with "Wait for property. Max 3 attempts reached." while the
        // wallet itself already showed the app as connected. The SDK's own
        // default is 30 attempts; ~36s is the ceiling for one /miner_check.
        await beeWaitForMiningKeyPropagation({
          appId: record.appId,
          minerAddress: record.minerAddress,
          expectedOwnerPublic: record.publicKey,
          maxAttempts: 30,
          intervalMs: 1200,
        });

        const handle = await beeCreateMiner({
          appId: record.appId,
          minerAddress: record.minerAddress,
          publicKey: record.publicKey,
          secretKey: record.secretKey,
        });

        // First-tap verification per the Bee Engine docs — confirms the
        // connected wallet really owns this mining key.
        //
        // This must go through a real (very short) session: add_tap() on a
        // freshly constructed Miner throws "No running workers to add tap to"
        // because start() is what spawns the workers. Reuses the same helper
        // the scheduler uses so there is only one tap/start/stop code path.
        const verification = await beeRunMiningSession(handle, {
          durationMs: 3000,
          tapCount: 1,
        });

        if (verification.error) {
          throw new Error(verification.error);
        }

        // A plan covers one wallet. Connecting a second one is allowed — the
        // connection itself is fine and its keys are now valid — but it lands
        // paused rather than mining, so a single subscription cannot quietly
        // run two wallets. Without this the /miner_start guard is bypassed
        // entirely, since connecting sets "active" directly.
        const alreadyMining =
          !isAdminChatId(chatId) &&
          countActiveMinersForChat(state.miners, chatId) >= 1;

        record.status = alreadyMining ? "stopped" : "active";
        record.lastError = null;

        if (alreadyMining) {
          await ctx.reply(
            [
              `✅ ${safeMessageText(record.walletName)} connected — but left paused.`,
              "",
              "A plan covers one mining wallet, and another one is already",
              "mining. Pause that one, then start this one.",
            ].join("\n"),
          );
        }

        // A wallet that mines with us belongs on the radar too. Best effort —
        // a failed lookup here must not undo a confirmed connection.
        try {
          registerSystemMiningWatch(
            await getAckiWalletActivity(record.walletName),
          );
        } catch (registerError) {
          console.warn("Miner wallet radar registration failed:", {
            walletName: record.walletName,
            message:
              registerError instanceof Error
                ? registerError.message
                : String(registerError),
          });
        }

        if (!alreadyMining) {
          await ctx.reply(
            `✅ ${record.walletName} bağlandı, otomatik madencilik başladı.`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Do not blame the user for a busy chain. When mainnet is congested
        // the SDK fails inside start() ("pool timed out", "queue is full"),
        // and start() not throwing but leaving no workers behind surfaces as
        // "No running workers to add tap to" — none of which means the wallet
        // approval is missing. Telling the user to re-approve in that case
        // sends them into a loop that regenerates keys and orphans the
        // approval they already gave.
        const chainBusy =
          /pool timed out|queue is full|No running workers|timed out|timeout/i.test(message);

        await ctx.reply(
          chainBusy
            ? `🌐 ${record.walletName} için onay alındı ama ağ şu an yoğun, bağlantı tamamlanamadı.\n\nCüzdanda tekrar onaylamana gerek yok — birkaç dakika sonra sadece /miner_check yaz.`
            : `⏳ ${record.walletName} henüz onaylanmamış görünüyor. AN Wallet'ta onayladıysan birkaç saniye sonra tekrar /miner_check dene.`,
        );

        console.error("miner_check failed:", {
          walletName: record.walletName,
          chainBusy,
          message,
        });
      }
    }

    writeBeeMinerState(state);
  }

  bot.command("miner_check", runMinerCheck);

  bot.action(/^mn:chk:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Checking…");
    await runMinerCheck(ctx);
    await sendWalletsScreen(ctx);
  });

  bot.command("miner_status", async (ctx) => {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Sohbet bilgisi alınamadı.");
      return;
    }

    const state = readBeeMinerState();
    const mine = state.miners.filter((m) => m.chatId === chatId);

    if (!mine.length) {
      await ctx.reply("Henüz bağlı bir cüzdanın yok. /miner_connect <cüzdan adı> ile başla.");
      return;
    }

    const statusLabel: Record<BeeMinerRecord["status"], string> = {
      pending_authorization: "⏳ Onay bekliyor",
      active: "✅ Aktif",
      error: "⚠️ Hata",
      stopped: "⏹️ Durduruldu",
    };

    const lines = mine.map((m) => {
      const bits = [
        `${m.walletName}: ${statusLabel[m.status]}`,
        m.lastSessionAt ? `Son oturum: ${m.lastSessionAt}` : null,
        m.lastTapsSent != null ? `Son tap sayısı: ${m.lastTapsSent}` : null,
        m.lastError ? `Son hata: ${m.lastError}` : null,
      ].filter(Boolean);
      return bits.join(" | ");
    });

    await ctx.reply(
      [
        "⛏️ Bulut Madencilik Durumu",
        "",
        buildEpochClockText(),
        "",
        ...lines,
      ].join("\n"),
    );
  });

  bot.command("epoch", async (ctx) => {
    await ctx.reply(buildMiningCycleRemainingText());
  });

  bot.command("miner_stop", async (ctx) => {
    const walletName = getCommandArgument(ctx.message?.text);
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Sohbet bilgisi alınamadı.");
      return;
    }

    if (!walletName) {
      await ctx.reply("Kullanım: /miner_stop <cüzdan adı>");
      return;
    }

    const state = readBeeMinerState();
    const record = state.miners.find(
      (m) => m.chatId === chatId && m.walletName === walletName,
    );

    if (!record) {
      await ctx.reply("Bu isimde bağlı bir cüzdan bulunamadı.");
      return;
    }

    record.status = "stopped";
    writeBeeMinerState(state);
    if (record.minerAddress) {
      beeDiscardMiner({
        appId: record.appId,
        minerAddress: record.minerAddress,
        publicKey: record.publicKey,
      });
    }

    await ctx.reply(`⏹️ ${walletName} için otomatik madencilik durduruldu.`);
  });

  bot.command("miner_start", async (ctx) => {
    const walletName = getCommandArgument(ctx.message?.text);
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Sohbet bilgisi alınamadı.");
      return;
    }

    if (
      !isAdminChatId(chatId) &&
      !hasActiveSubscriptionForChat(readPaymentsState(), chatId)
    ) {
      await ctx.reply(
        [
          "💎 Aktif bir bulut madenciliği aboneliğin yok.",
          "",
          `Önce ${TRIAL_DAYS} günlük ücretsiz denemeyi kullanabilir veya bir plan satın alabilirsin.`,
          "",
          "Planlar: /plans",
          `Ücretsiz deneme: /trial`,
        ].join("\n"),
      );
      return;
    }

    const state = readBeeMinerState();
    const ownMiners = state.miners.filter((miner) => miner.chatId === chatId);
    const stoppedMiners = ownMiners.filter((miner) => miner.status === "stopped");
    const record = walletName
      ? ownMiners.find((miner) => miner.walletName === walletName)
      : stoppedMiners.length === 1
        ? stoppedMiners[0]!
        : undefined;

    if (!record) {
      await ctx.reply(
        walletName
          ? "Bu isimde bağlı bir cüzdan bulunamadı."
          : "Kullanım: /miner_start <cüzdan adı>",
      );
      return;
    }

    if (record.status !== "stopped") {
      await ctx.reply(
        record.status === "active"
          ? `✅ ${record.walletName} is already mining.`
          : `⚠️ ${record.walletName} is ${record.status}. Finish connecting it first.`,
      );
      return;
    }

    // One wallet per plan. Refusing here — rather than letting it be marked
    // active and then quietly skipped by the scheduler — is the difference
    // between a clear answer and a wallet that looks started but never mines.
    if (
      !isAdminChatId(chatId) &&
      countActiveMinersForChat(state.miners, chatId) >= 1
    ) {
      const active = state.miners.find(
        (m) => m.chatId === chatId && m.status === "active",
      );

      await ctx.reply(
        [
          "⚠️ A plan covers one mining wallet.",
          "",
          `Currently mining: ${active ? safeMessageText(active.walletName) : "—"}`,
          "",
          "Pause that one first, then start this one.",
        ].join("\n"),
      );
      return;
    }

    record.status = "active";
    record.lastError = null;
    writeBeeMinerState(state);

    await ctx.reply(`✅ ${record.walletName} için otomatik madencilik başlatıldı.`);
  });

  bot.command("plans", async (ctx) => {
    // Prices are quoted in USDT now. The plan's priceUsd is the source of
    // truth: USDT is a stable unit, so unlike the SHELL rail there is no
    // guessed peg between the listed price and what the user sends.
    await ctx.reply(
      [
        "💳 Bulut Madencilik Planları",
        "",
        ...PLANS.map(
          (plan) =>
            `${plan.label} — ${plan.days} gün — ${getPlanStars(plan)} ⭐ (${getPlanStarsPriceUsd(plan)} USDT)`,
        ),
        "",
        "NACKL ile ödeme:",
        ...PLANS.map(
          (plan) =>
            `${plan.label} — ${plan.days} gün — ${formatNacklAmount(plan.priceNacklRaw)} NACKL`,
        ),
        "",
        `🎁 ${TRIAL_DAYS} gün ücretsiz deneme: /trial`,
        "",
        "Telegram'dan yıldız ile: /pay <standard|max|super>",
        "NACKL ile: /plan_buy_nackl <standard|max|super>",
        "Kripto ile ödemek istersen panelden: https://ackinackiradar.com",
        "",
        "Bizde ayrıca:",
        "• Canlı web paneli — ödül akışı, döngü durumu, ağ istatistikleri",
        "• 7/24 çalışır, uygulamayı açık tutman gerekmez",
      ].join("\n"),
    );
  });

  bot.command("plan_buy", async (ctx) => {
    if (!PAYMENTS_CHECK_ENABLED && !TON_PAYMENTS_CHECK_ENABLED) {
      await ctx.reply(
        "Ödeme doğrulama şu an aktif değil; lütfen ödeme göndermeden önce yöneticiyle iletişime geç.",
      );
      return;
    }

    const planId = getCommandArgument(ctx.message?.text).trim().toLowerCase();
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Sohbet bilgisi alınamadı.");
      return;
    }

    // Keep the low-value test invoice completely hidden from normal users.
    // It exercises the same production TON/USDT settlement path as a real
    // package, but can only be issued from the configured admin account.
    const plan =
      planId === TEST_PLAN.id && isRealAdminContext(ctx)
        ? TEST_PLAN
        : getPlanById(planId);

    if (!plan) {
      await ctx.reply("Kullanım: /plan_buy <standard|max|super>");
      return;
    }

    if (TON_PAYMENTS_CHECK_ENABLED) {
      // The TON rail identifies the payment by the invoice code in the
      // transfer comment, so — unlike the SHELL rail — there is no need for a
      // mining wallet to be connected first. Requiring one here would recreate
      // the catch-22 where mining needs a subscription and a subscription
      // needed a miner.
      const state = readPaymentsState();
      const now = Date.now();

      // Reuse a live invoice instead of minting a second code for the same
      // plan; two open codes for one buyer only invites paying the wrong one.
      const existing = state.pendingInvoices.find(
        (item) =>
          item.chatId === chatId &&
          item.planId === plan.id &&
          item.currency === "usdt" &&
          new Date(item.expiresAt).getTime() > now,
      );

      let invoice: PendingInvoice;

      if (existing) {
        invoice = existing;
      } else {
        // Quote TON alongside USDT so the payer can use whichever they hold.
        // The rate is locked into the invoice here: a price move during the
        // payment window is then irrelevant. If the feed is unreachable we
        // simply do not quote TON — selling at a guessed rate would be worse
        // than offering one currency.
        let amountTonRaw: string | undefined;
        let tonUsdRate: number | undefined;

        try {
          const rate = await fetchTonUsdRate(TONAPI_KEY);
          tonUsdRate = rate;
          amountTonRaw = usdToTonRaw(plan.priceUsd, rate);
        } catch (error) {
          console.warn("TON payments: rate unavailable, quoting USDT only:", {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        invoice = {
          id: `${chatId}:${plan.id}:${now}`,
          chatId,
          planId: plan.id,
          amountRaw: usdtAmountToRaw(plan.priceUsd),
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + TON_INVOICE_EXPIRY_MS).toISOString(),
          code: buildInvoiceCode(),
          currency: "usdt",
          ...(amountTonRaw ? { amountTonRaw } : {}),
          ...(tonUsdRate ? { tonUsdRate } : {}),
        };

        state.pendingInvoices.push(invoice);
        writePaymentsState(state);
      }

      const minutesLeft = Math.max(
        1,
        Math.round(
          (new Date(invoice.expiresAt).getTime() - now) / 60000,
        ),
      );

      await ctx.reply(
        [
          `💳 ${plan.label} — ${plan.days} gün`,
          "",
          "Şunlardan BİRİNİ gönder:",
          `• ${formatUsdtAmount(invoice.amountRaw)} USDT`,
          ...(invoice.amountTonRaw
            ? [`• ${formatTonAmount(invoice.amountTonRaw)} TON`]
            : []),
          "",
          "Ağ: TON",
          "Adres:",
          TON_PAYMENTS_ADDRESS,
          "",
          "Açıklama / comment alanına MUTLAKA bunu yaz:",
          invoice.code || "",
          "",
          "⚠️ Açıklama olmadan gönderilen ödeme otomatik eşleşmez.",
          "⚠️ Sadece TON ağı kullan. Başka ağdan gönderilen para kaybolur.",
          "",
          ...(invoice.amountTonRaw
            ? [`TON tutarı bu fatura için sabitlendi, kur değişse de geçerli.`]
            : []),
          `Bu fatura ${minutesLeft} dakika geçerli.`,
          "Ödeme onaylanınca otomatik mesaj göndereceğim.",
        ].join("\n"),
      );
      return;
    }

    // Fix: payment matching now identifies the payer by WHICH WALLET sent
    // the SHELL (matched against a connected, verified mining wallet) —
    // same approach used by comparable services ("only registered wallets
    // can top up"). So a wallet must already be connected via
    // /miner_connect + /miner_check before a plan can be purchased.
    const minerState = readBeeMinerState();
    const activeMiners = minerState.miners.filter(
      (miner) => miner.chatId === chatId && miner.status === "active",
    );

    if (!activeMiners.length) {
      await ctx.reply(
        "Önce bir cüzdanı /miner_connect <cüzdan adı> ile bağlayıp /miner_check ile onaylaman gerekiyor. Ödeme, bağladığın cüzdandan gelmeli.",
      );
      return;
    }

    const state = readPaymentsState();
    const now = Date.now();
    const amountRaw = allocateInvoiceAmountRaw(plan, state);

    const invoice: PendingInvoice = {
      id: `${chatId}:${plan.id}:${now}`,
      chatId,
      planId: plan.id,
      amountRaw,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PAYMENTS_INVOICE_EXPIRY_MS).toISOString(),
    };

    state.pendingInvoices.push(invoice);
    writePaymentsState(state);

    const walletNames = activeMiners.map((miner) => miner.walletName).join(", ");

    await ctx.reply(
      [
        `💳 <b>${escapeHtml(plan.label)} planı</b> — ${plan.days} gün`,
        "",
        `Şu tutarı gönder (dokunup kopyalayabilirsin):`,
        `<code>${escapeHtml(formatShellAmount(invoice.amountRaw))}</code> SHELL`,
        "",
        `Alıcı cüzdan: <code>${escapeHtml(PAYMENTS_WALLET_NAME)}</code>`,
        `Gönderen cüzdan: bağladığın cüzdan (${escapeHtml(walletNames)}) olmalı — başka bir cüzdandan gönderirsen eşleşmez.`,
        "",
        "Ödeme algılandığında bot sana otomatik onay mesajı gönderecek",
        `(30 dakika içinde gönderilmezse fatura geçersiz olur).`,
      ].join("\n"),
      { parse_mode: "HTML" },
    );
  });

  bot.command("plan_buy_nackl", async (ctx) => {
    if (!NACKL_PAYMENTS_CHECK_ENABLED) {
      await ctx.reply("NACKL ödeme doğrulaması şu an aktif değil.");
      return;
    }

    const chatId = ctx.chat?.id;
    const planId = getCommandArgument(ctx.message?.text).trim().toLowerCase();

    if (!chatId) {
      await ctx.reply("Sohbet bilgisi alınamadı.");
      return;
    }

    const plan =
      planId === TEST_PLAN.id && isRealAdminContext(ctx)
        ? TEST_PLAN
        : getPlanById(planId);

    if (!plan) {
      await ctx.reply("Kullanım: /plan_buy_nackl <standard|max|super>");
      return;
    }

    const state = readPaymentsState();

    if (!state.nacklBaselineReady) {
      await ctx.reply(
        "NACKL ödeme izleyicisi hazırlanıyor; lütfen kısa süre sonra tekrar dene.",
      );
      return;
    }

    const now = Date.now();
    let invoice = state.pendingInvoices.find(
      (item) =>
        item.chatId === chatId &&
        item.planId === plan.id &&
        item.currency === "nackl" &&
        new Date(item.expiresAt).getTime() > now,
    );

    if (!invoice) {
      invoice = {
        id: `nackl:${chatId}:${plan.id}:${now}`,
        chatId,
        planId: plan.id,
        // The admin-only test invoice is deliberately exactly 1 NACKL so it
        // can be exercised by an almost-empty wallet. Public plans retain the
        // unique fractional marker used for automatic matching.
        amountRaw:
          plan.id === TEST_PLAN.id
            ? plan.priceNacklRaw
            : allocateNacklInvoiceAmountRaw(plan, state),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + NACKL_INVOICE_EXPIRY_MS).toISOString(),
        currency: "nackl",
      };
      state.pendingInvoices.push(invoice);
      writePaymentsState(state);
    }

    const minutesLeft = Math.max(
      1,
      Math.round((new Date(invoice.expiresAt).getTime() - now) / 60000),
    );

    await ctx.reply(
      [
        `💳 <b>${escapeHtml(plan.label)}</b> — ${plan.days} gün`,
        "",
        "Gönderilecek tam tutar:",
        `<code>${escapeHtml(formatNacklAmount(invoice.amountRaw))}</code> NACKL`,
        "",
        `Alıcı cüzdan: <code>${escapeHtml(NACKL_PAYMENTS_WALLET_NAME)}</code>`,
        "Ağ: Acki Nacki",
        "",
        "⚠️ Tutarı küsuratıyla birlikte eksiksiz gönder. Bu küçük küsurat faturayı hesabınla eşleştirir.",
        "Açıklama yazman gerekmez. Ağ ücreti için cüzdanında az miktarda SHELL bulunmalı.",
        "",
        `Fatura ${minutesLeft} dakika geçerli. Transfer algılanınca abonelik otomatik açılır.`,
      ].join("\n"),
      { parse_mode: "HTML" },
    );
  });

  bot.command("plan_status", async (ctx) => {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.reply("Sohbet bilgisi alınamadı.");
      return;
    }

    const state = readPaymentsState();
    const subscription = state.subscriptions[String(chatId)];

    if (!subscription) {
      await ctx.reply("Aktif bir aboneliğin yok. /plans ile planları görebilirsin.");
      return;
    }

    const plan = getPlanById(subscription.planId);
    const activeUntil = new Date(subscription.activeUntil);
    const isActive = activeUntil.getTime() > Date.now();

    await ctx.reply(
      [
        `📋 Abonelik Durumu`,
        "",
        `Plan: ${plan?.label || subscription.planId}`,
        `Durum: ${isActive ? "✅ Aktif" : "⏹️ Süresi dolmuş"}`,
        `Bitiş: ${activeUntil.toLocaleString("tr-TR")}`,
      ].join("\n"),
    );
  });

  bot.command("payments_pending", async (ctx) => {
    if (!isAdminContext(ctx)) {
      await replyAdminOnly(ctx);
      return;
    }

    const state = readPaymentsState();

    if (!state.pendingInvoices.length) {
      await ctx.reply("Bekleyen fatura yok.");
      return;
    }

    const lines = state.pendingInvoices.map((invoice) => {
      const plan = resolvePaidPlan(invoice.planId);
      const amount = invoice.currency === "nackl"
        ? `${formatNacklAmount(invoice.amountRaw)} NACKL`
        : invoice.currency === "usdt"
          ? `${formatUsdtAmount(invoice.amountRaw)} USDT`
          : `${formatShellAmount(invoice.amountRaw)} SHELL`;
      return `${invoice.id} — chatId: ${invoice.chatId} — ${plan?.label || invoice.planId} — ${amount} — son geçerlilik: ${new Date(invoice.expiresAt).toLocaleString("tr-TR")}`;
    });

    await ctx.reply(["⏳ Bekleyen Faturalar", "", ...lines].join("\n"));
  });

  bot.command("payments_manual_activate", async (ctx) => {
    if (!isAdminContext(ctx)) {
      await replyAdminOnly(ctx);
      return;
    }

    // Fix: safety net for when the automated amount-matching misses a real
    // payment (e.g. a typo in the sent amount) — lets the admin manually
    // reconcile without the customer being stuck.
    const args = getCommandArgument(ctx.message?.text).trim().split(/\s+/);
    const targetChatId = Number(args[0]);
    const planId = (args[1] || "").toLowerCase();

    if (!targetChatId || !getPlanById(planId)) {
      await ctx.reply("Kullanım: /payments_manual_activate <chatId> <standard|max|super>");
      return;
    }

    const plan = getPlanById(planId)!;
    const state = readPaymentsState();
    const existing = state.subscriptions[String(targetChatId)];
    const now = Date.now();
    const base =
      existing && new Date(existing.activeUntil).getTime() > now
        ? new Date(existing.activeUntil).getTime()
        : now;
    const activeUntil = new Date(base + plan.days * 24 * 60 * 60 * 1000).toISOString();

    state.subscriptions[String(targetChatId)] = { planId: plan.id, activeUntil };
    writePaymentsState(state);

    await ctx.reply(`✅ ${targetChatId} için ${plan.label} planı manuel aktif edildi (bitiş: ${activeUntil}).`);

    try {
      await bot.telegram.sendMessage(
        targetChatId,
        `✅ Ödemen elle onaylandı! ${plan.label} planı aktif. Bitiş: ${new Date(activeUntil).toLocaleString("tr-TR")}`,
      );
    } catch {
      // Best-effort notify; admin already has confirmation above.
    }
  });

  bot.command("monitor_tick", async (ctx) => {
    if (!isAdminContext(ctx)) {
      await replyAdminOnly(ctx);
      return;
    }

    await ctx.reply("Manual wallet scan tick started.");
    await runMiningMonitorTick(bot, "manual_admin");
    await ctx.reply(buildMonitorStatusMessage());
  });
  bot.command("emoji_id", replyEmojiId);
  bot.command("debug_popit", replyDebugPopit);
  bot.command("debug_tokens", replyDebugTokens);
  bot.command("debug_mininghub", async (ctx) => {
    if (!isAdminContext(ctx)) {
      await replyAdminOnly(ctx);
      return;
    }
    await ctx.reply(
      "MiningHub kaldırıldı — artık sadece mainnet.ackinacki.org/graphql kullanılıyor. /debug_popit deneyin.",
    );
  });
  bot.command("quests", async (ctx) => ctx.reply(buildComingSoonMessage()));
  bot.command("profile", async (ctx) => ctx.reply(buildComingSoonMessage()));
  bot.command("claim", async (ctx) => ctx.reply(buildComingSoonMessage()));
  bot.command("leaderboard", async (ctx) =>
    ctx.reply(buildComingSoonMessage()),
  );
  bot.command("tasks", async (ctx) => ctx.reply(buildComingSoonMessage()));
  bot.command("dashboard", async (ctx) => ctx.reply(buildComingSoonMessage()));

  bot.action("wallet_info", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(buildWalletInfoPrompt());
  });

  bot.action("help", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(buildHelpMessage(ctx.from?.language_code));
  });

  // The whole wallet-watch button surface (add / list / settings / toggle /
  // delete) went with the commands on 2026-08-09 — see the note next to the
  // command registrations.  Leaving the buttons bound while the commands were
  // gone would have kept the removed feature reachable.
  //
  // Those buttons still exist in old messages sitting in people's chat
  // history, though, and an unanswered callback query leaves the button
  // spinning until Telegram times it out.  Answer them so the spinner stops
  // and the user gets told why nothing happened.
  bot.action(
    /^(mw:.*|wallets|watchlist|mining|mining_watch_prompt)$/,
    async (ctx) => {
      await ctx.answerCbQuery("Bu özellik kaldırıldı.");
      await ctx.reply(
        [
          "Cüzdan takip menüsü kaldırıldı.",
          "",
          "Cüzdan sorgulamak için: /info ackerman",
          "Kayıt silmek için: /forget",
        ].join("\n"),
      );
    },
  );

  bot.action("coming_soon", async (ctx) => {
    await ctx.answerCbQuery("Coming soon");
    await ctx.reply(buildComingSoonMessage());
  });

  bot.action("dashboard", async (ctx) => {
    await ctx.answerCbQuery("Coming soon");
    await ctx.reply(buildComingSoonMessage());
  });

  bot.action("profile", async (ctx) => {
    await ctx.answerCbQuery("Coming soon");
    await ctx.reply(buildComingSoonMessage());
  });

  bot.action("referral", async (ctx) => {
    await ctx.answerCbQuery("Coming soon");
    await ctx.reply(buildComingSoonMessage());
  });

  bot.action("claim", async (ctx) => {
    await ctx.answerCbQuery("Coming soon");
    await ctx.reply(buildComingSoonMessage());
  });

  bot.action("leaderboard", async (ctx) => {
    await ctx.answerCbQuery("Coming soon");
    await ctx.reply(buildComingSoonMessage());
  });
  bot.action("tasks", async (ctx) => {
    await ctx.answerCbQuery("Coming soon");
    await ctx.reply(buildComingSoonMessage());
  });

  bot.action(/^complete_task:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Coming soon");
    await ctx.reply(buildComingSoonMessage());
  });
  // Reply-keyboard buttons arrive as ordinary text, so each label needs its own
  // handler. Registered before the catch-all below.
  bot.hears(MENU_PLANS, async (ctx) => {
    await ctx.reply(
      [
        "⭐ Pay with Telegram Stars",
        "",
        ...PLANS.map(
          (plan) =>
            `${plan.label} — ${plan.days} days — ${getPlanStars(plan)} ⭐ (${getPlanStarsPriceUsd(plan)} USDT)`,
        ),
        "",
        "To buy:",
        ...PLANS.map((plan) => `/pay ${plan.id}`),
        "",
        "Pay with NACKL:",
        ...PLANS.map(
          (plan) =>
            `${formatNacklAmount(plan.priceNacklRaw)} NACKL — /plan_buy_nackl ${plan.id}`,
        ),
        "",
        `🎁 ${TRIAL_DAYS}-day free trial: /trial`,
        "",
        "To pay with crypto (USDT/TON) and manage mining, use the dashboard:",
        "https://ackinackiradar.com",
      ].join("\n"),
    );
  });

  bot.hears(MENU_WALLETS, async (ctx) => {
    await sendWalletsScreen(ctx);
  });

  // Start / pause from the wallets screen.
  bot.action(/^mn:tg:(.+)$/, async (ctx) => {
    const walletName = String((ctx as any).match[1] || "");
    const chatId = ctx.chat?.id;
    const state = readBeeMinerState();
    const record = state.miners.find(
      (m) => m.chatId === chatId && m.walletName === walletName,
    );

    if (!record) {
      await ctx.answerCbQuery("Wallet not found.");
      return;
    }

    if (record.status !== "active" && record.status !== "stopped") {
      await ctx.answerCbQuery(`Not ready yet (${record.status}).`);
      return;
    }

    const running = record.status === "active";

    // One wallet per plan — same rule the scheduler enforces, applied here so
    // the button gives a reason instead of appearing to work and doing nothing.
    if (
      !running &&
      !isAdminChatId(chatId as number) &&
      countActiveMinersForChat(state.miners, chatId as number) >= 1
    ) {
      await ctx.answerCbQuery(
        "A plan covers one wallet. Pause the other one first.",
        { show_alert: true },
      );
      return;
    }

    record.status = running ? "stopped" : "active";
    record.lastError = null;
    writeBeeMinerState(state);

    // Drop the pooled instance when pausing, so a half-finished session does
    // not keep running against a wallet the user just stopped.
    if (running && record.minerAddress) {
      beeDiscardMiner({
        appId: record.appId,
        minerAddress: record.minerAddress,
        publicKey: record.publicKey,
      });
    }

    await ctx.answerCbQuery(running ? "Paused." : "Started.");
    await sendWalletsScreen(ctx);
  });

  // Remove — asks first, since it deletes the stored mining keys.
  bot.action(/^mn:rm:(.+)$/, async (ctx) => {
    const walletName = String((ctx as any).match[1] || "");

    await ctx.answerCbQuery();
    await ctx.reply(
      `🗑 Remove ${safeMessageText(walletName)}?\n\nMining stops and the stored keys are deleted. This cannot be undone.`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("Yes, remove", `mn:rmy:${walletName}`),
          Markup.button.callback("Cancel", "mn:cancel"),
        ],
      ]),
    );
  });

  bot.action(/^mn:rmy:(.+)$/, async (ctx) => {
    const walletName = String((ctx as any).match[1] || "");
    const chatId = ctx.chat?.id;
    const state = readBeeMinerState();
    const record = state.miners.find(
      (m) => m.chatId === chatId && m.walletName === walletName,
    );

    if (!record) {
      await ctx.answerCbQuery("Wallet not found.");
      return;
    }

    if (record.minerAddress) {
      beeDiscardMiner({
        appId: record.appId,
        minerAddress: record.minerAddress,
        publicKey: record.publicKey,
      });
    }

    state.miners = state.miners.filter((m) => m.id !== record.id);
    writeBeeMinerState(state);

    console.log("Miner removed via wallets screen:", {
      chatId,
      walletName: record.walletName,
      previousStatus: record.status,
    });

    await ctx.answerCbQuery("Removed.");
    await sendWalletsScreen(ctx);
  });

  bot.action("mn:cancel", async (ctx) => {
    await ctx.answerCbQuery("Cancelled.");
  });

  // Add: force_reply turns the next message into the wallet name, so nobody
  // has to remember a command.
  bot.action("mn:add", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(WALLET_ADD_PROMPT, Markup.forceReply());
  });

  bot.hears(MENU_PANEL, async (ctx) => {
    // This is the only place that explains how to get started, now that wallet
    // connection lives on the dashboard rather than in the bot.
    await ctx.reply(
      [
        "🌐 Dashboard",
        "",
        "Connect a wallet, start/stop mining, watch the live reward feed,",
        "follow the cycle and pay with USDT/TON — all in one place:",
        "",
        "https://ackinackiradar.com",
        "",
        "How to get started:",
        "1) Open the link and press “Telegram ile devam et”",
        "2) Enter your Acki Nacki wallet name and connect it",
        "3) Approve the request in your wallet app, then press Check",
        "",
        "⚠️ Sign in with Telegram, not with the wallet-name option —",
        "a subscription bought here is tied to your Telegram account.",
      ].join("\n"),
    );
  });

  bot.hears(MENU_HELP, async (ctx) => {
    await ctx.reply(buildHelpMessage(ctx.from?.language_code));
  });

  // /info keeps the persistent keyboard visible while waiting for the next
  // plain-text wallet name/address. A direct reply to the prompt also works.
  bot.on("text", async (ctx, next) => {
    const replyTo = (ctx.message as any)?.reply_to_message;
    const chatId = Number(ctx.chat?.id);
    const pendingUntil = pendingWalletInfoInputs.get(chatId) || 0;
    const isPromptReply = String(replyTo?.text || "") === WALLET_INFO_PROMPT;

    if (!isPromptReply && pendingUntil <= Date.now()) {
      return next();
    }

    const input = String(ctx.message?.text || "").trim();
    pendingWalletInfoInputs.delete(chatId);

    if (!input || input.startsWith("/")) {
      return next();
    }

    await replyWalletInfo(ctx, input);
  });

  // The "Add wallet" button asks with force_reply; this catches the answer.
  // Matching on the prompt text of the replied-to message is what Telegram
  // gives us — there is no per-request id on a force_reply.
  bot.on("text", async (ctx, next) => {
    const replyTo = (ctx.message as any)?.reply_to_message;

    if (!replyTo || String(replyTo.text || "") !== WALLET_ADD_PROMPT) {
      return next();
    }

    const walletName = String(ctx.message?.text || "").trim();

    if (!walletName || walletName.startsWith("/")) {
      await ctx.reply("That does not look like a wallet name. Press “Add wallet” again.");
      return;
    }

    await startWalletConnect(ctx, walletName);
  });

  bot.on("text", async (ctx) => {
    const text = String(ctx.message?.text || "").trim();

    if (text.startsWith("/")) {
      await ctx.reply("Unknown command. Use /help.");
    }
  });

  bot.catch((error) => {
    console.error("Bot hatası:", error);
  });

  const fullCommandList = [
    // The two menus are split by subject, not duplicated:
    //   "/" menu  -> the radar side: wallet lookup, plus start/help
    //   keyboard  -> the paid side: Stars purchase and the dashboard
    // Deliberately NO mining command here — mining is managed on the
    // dashboard, and listing /miner_* in both places is what made the bot feel
    // like it had two competing menus. They still work when typed.
    { command: "start", description: "🚀 Open the menu" },
    { command: "info", description: "🔍 Look up a wallet" },
    { command: "epoch", description: "⏳ Mining cycle remaining" },
    { command: "trial", description: "🎁 Start the 3-day trial" },
    { command: "help", description: "ℹ️ Help" },
  ];
  const groupCommandList = [
    { command: "info", description: "Show wallet radar" },
    { command: "help", description: "Show help" },
  ];

  // Fix: the command menu (the "/" button) showed the full command list even
  // in groups/channels, where only /info and /help actually do anything now.
  // Telegram supports per-scope command menus, so private chats keep seeing
  // everything while groups/channels only see the two that work there.
  await bot.telegram.setMyCommands(fullCommandList, {
    scope: { type: "all_private_chats" },
  });
  await bot.telegram.setMyCommands(groupCommandList, {
    scope: { type: "all_group_chats" },
  });
  await bot.telegram.setMyCommands(groupCommandList, {
    scope: { type: "all_chat_administrators" },
  });
  // Keep the default scope (used as a fallback for anything not covered
  // above, e.g. channels) aligned with the restrictive group list.
  await bot.telegram.setMyCommands(groupCommandList);

  // setMyCommands can make Telegram restore the default "commands" button.
  // Apply the Mini App button last so it stays on the left after every restart.
  // The former command choices live behind the right-side reply keyboard.
  await bot.telegram.setChatMenuButton({
    menuButton: {
      type: "web_app",
      text: "Dashboard",
      web_app: { url: DASHBOARD_MINI_APP_URL },
    },
  });
  console.log("Telegram menu button set: Dashboard Mini App");

  const launchPromise = bot.launch();

  if (MINING_MONITOR_ENABLED) {
    startMiningMonitorScheduler(bot);

    if (MINING_SUMMARY_ENABLED) {
      startMiningSummaryScheduler(bot);
    } else {
      console.log(
        "Mining summary scheduler disabled by MINING_SUMMARY_ENABLED=false",
      );
    }
  } else {
    console.log(
      "Mining monitor scheduler disabled by MINING_MONITOR_ENABLED=false",
    );
  }

  startPaymentsCheckScheduler(bot);
  startTonPaymentsScheduler(bot);
  startNacklPaymentsScheduler(bot);

  const me = await bot.telegram.getMe();
  console.log(`Telegram bot çalışıyor: @${me.username}`);

  process.once("SIGINT", () => {
    if (miningMonitorTimer) clearTimeout(miningMonitorTimer);
    if (miningSummaryTimer) clearTimeout(miningSummaryTimer);
    if (beeMiningTimer) clearTimeout(beeMiningTimer);
    if (paymentsCheckTimer) clearTimeout(paymentsCheckTimer);
    if (tonPaymentsTimer) clearTimeout(tonPaymentsTimer);
    if (nacklPaymentsTimer) clearTimeout(nacklPaymentsTimer);
    bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    if (miningMonitorTimer) clearTimeout(miningMonitorTimer);
    if (miningSummaryTimer) clearTimeout(miningSummaryTimer);
    if (beeMiningTimer) clearTimeout(beeMiningTimer);
    if (paymentsCheckTimer) clearTimeout(paymentsCheckTimer);
    if (tonPaymentsTimer) clearTimeout(tonPaymentsTimer);
    if (nacklPaymentsTimer) clearTimeout(nacklPaymentsTimer);
    bot.stop("SIGTERM");
  });

  await launchPromise;
}
