import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getAckiNetworkStats, getAckiWalletActivity } from "./services/ackiProvider";
import { isAdminTestModeOn, setAdminTestMode, sendAdminNotification } from "./bot";
import {
  collectReward as beeCollectReward,
  discardMiner as beeDiscardMiner,
  generateMiningKeys as beeGenerateMiningKeys,
  isBeeChainCritical,
  resolveMinerAddress as beeResolveMinerAddress,
  waitForMiningKeyPropagation as beeWaitForMiningKeyPropagation,
} from "./services/beeMiner";
import {
  buildInvoiceAmountRaw,
  buildNacklInvoiceAmountRaw,
  formatNacklAmount,
  getPlanById,
  getPlanStars,
  getPlanStarsPriceUsd,
  PLANS,
  type Plan,
} from "./services/payments";
import {
  buildInvoiceCode,
  fetchTonUsdRate,
  formatTonAmount,
  formatUsdtAmount,
  usdToTonRaw,
  usdtAmountToRaw,
} from "./services/tonPayments";
import { getChainEpochClock } from "./services/epochClock";

// Same switches the bot's TON checker reads — the dashboard only issues the
// invoices, that checker is what credits them.
// Same env var the bot reads, so "admin" means the same thing on both sides.
// Compared as strings because that is how the bot stores them.
const DASHBOARD_ADMIN_IDS = new Set(
  String(process.env.BOT_ADMIN_IDS || process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const DASHBOARD_ALLOWED_ORIGINS = [
  "https://ackinackiradar.com",
  "https://www.ackinackiradar.com",
];

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

function createRateLimiter(options: {
  maxRequests: number;
  windowMs: number;
  scope: string;
}) {
  const buckets = new Map<string, RateLimitBucket>();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();

    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, options.windowMs);

  cleanupTimer.unref();

  return (req: any, res: any, next: any) => {
    const now = Date.now();
    const clientAddress = String(
      req.ip || req.socket?.remoteAddress || "unknown",
    );
    const key = `${options.scope}:${clientAddress}`;
    const current = buckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + options.windowMs }
        : current;

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, options.maxRequests - bucket.count);
    res.setHeader("RateLimit-Limit", String(options.maxRequests));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader(
      "RateLimit-Reset",
      String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
    );

    if (bucket.count > options.maxRequests) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
      );
      res.status(429).json({ ok: false, error: "RATE_LIMITED" });
      return;
    }

    next();
  };
}

const TON_PAYMENTS_ADDRESS = String(process.env.TON_PAYMENTS_ADDRESS || "").trim();
const TON_PAYMENTS_CHECK_ENABLED =
  String(process.env.TON_PAYMENTS_CHECK_ENABLED || "false").toLowerCase() ===
    "true" && Boolean(TON_PAYMENTS_ADDRESS);
const TONAPI_KEY = String(process.env.TONAPI_KEY || "").trim() || undefined;
const TON_INVOICE_EXPIRY_MS =
  Number(process.env.TON_INVOICE_EXPIRY_MINUTES || 120) * 60 * 1000;

type UserRecord = {
  telegramId: number;
  firstName: string;
  username?: string;
  referralCode: string;
  referredBy?: string;
  points: number;
  createdAt: string;
  lastClaimDate?: string;
  miningStartedAt?: string;
completedTasks?: string[];
};

const dataDir = path.join(process.cwd(), "data");
const usersFile = path.join(dataDir, "users.json");
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

function getMiningStatus(user: UserRecord) {
  if (!user.miningStartedAt) {
    return {
      active: false,
      minutes: 0,
      power: 0,
      hash: 0,
    };
  }

  const startedAt = new Date(user.miningStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - startedAt.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 1000 / 60));

  return {
    active: true,
    minutes,
    power: Math.min(100, 10 + Math.floor(minutes / 3)),
    hash: minutes * 7,
  };
}

function getDisplayName(user: UserRecord) {
  return user.username ? "@" + user.username : user.firstName;
}

// Fix: lightweight public stat for the ackinackiradar.com coming-soon page —
// reads the mining monitor's own state file (used by the wallet-tracking
// Telegram bot) and returns how many unique wallets are currently watched.
// This is intentionally separate from the "Web3hunter Mining" users.json
// system above, which is a different, unrelated app living on the same
// server.
// Aggregate mining stats across every tracked wallet — the one number set
// nobody else on this chain has, since it comes from our own monitor history
// rather than from public chain state.
//
// mining-monitor.json is multi-megabyte, so parsing it per request would be
// wasteful for a stat strip polled by every visitor. Cached on the file's
// mtime+size: a re-read only happens after the monitor actually writes.
type RadarMiningStats = {
  wallets: number;
  nacklLast24hRaw: string;
  nacklLast7dRaw: string;
  nacklTotalRaw: string;
  eventsTracked: number;
  updatedAt: string;
};

let miningStatsCache: { key: string; at: number; data: RadarMiningStats } | null = null;
const MINING_STATS_MAX_AGE_MS = 60 * 1000;

function safeBig(value: unknown): bigint {
  try {
    const text = String(value ?? "0").trim();
    return /^-?\d+$/.test(text) ? BigInt(text) : 0n;
  } catch {
    return 0n;
  }
}

function getRadarMiningStats(): RadarMiningStats {
  const stateFile = path.join(process.cwd(), "data", "mining-monitor.json");

  const empty: RadarMiningStats = {
    wallets: 0,
    nacklLast24hRaw: "0",
    nacklLast7dRaw: "0",
    nacklTotalRaw: "0",
    eventsTracked: 0,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (!fs.existsSync(stateFile)) return empty;

    const stat = fs.statSync(stateFile);
    const key = `${stat.mtimeMs}:${stat.size}`;

    if (
      miningStatsCache &&
      miningStatsCache.key === key &&
      Date.now() - miningStatsCache.at < MINING_STATS_MAX_AGE_MS
    ) {
      return miningStatsCache.data;
    }

    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    const watches = Array.isArray(state?.watches) ? state.watches : [];

    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const weekDay = dayKey(weekAgo);

    let day = 0n;
    let week = 0n;
    let total = 0n;
    let events = 0;
    const addresses = new Set<string>();

    for (const watch of watches) {
      const address = String(watch?.address || "").trim().toLowerCase();
      if (address) addresses.add(address);

      for (const event of Array.isArray(watch?.events) ? watch.events : []) {
        const delta = safeBig(event?.deltaRaw);
        const at = new Date(event?.at).getTime();
        events += 1;
        total += delta;
        if (Number.isFinite(at)) {
          if (at >= dayAgo) day += delta;
          if (at >= weekAgo) week += delta;
        }
      }

      // Older history lives as one total per UTC day (see foldMiningEvents in
      // bot.ts). Buckets only exist for days already dropped from events, so
      // adding both cannot double-count.
      for (const bucket of Array.isArray(watch?.dailyTotals) ? watch.dailyTotals : []) {
        const delta = safeBig(bucket?.deltaRaw);
        total += delta;
        if (String(bucket?.day || "") >= weekDay) week += delta;
      }
    }

    const data: RadarMiningStats = {
      wallets: addresses.size,
      nacklLast24hRaw: day.toString(),
      nacklLast7dRaw: week.toString(),
      nacklTotalRaw: total.toString(),
      eventsTracked: events,
      updatedAt: new Date().toISOString(),
    };

    miningStatsCache = { key, at: Date.now(), data };
    return data;
  } catch (error) {
    console.error("getRadarMiningStats failed:", error);
    return empty;
  }
}

// --- TPS history ----------------------------------------------------------
//
// The chain exposes instantaneous throughput only, so 24h/7d averages have to
// be something we measure and keep ourselves. Same two-tier shape as the
// mining events (see foldMiningEvents in bot.ts): raw samples for the last
// day, one bucket per hour beyond that. A week of hourly buckets is ~170 rows
// instead of ~10,000 raw samples.
type TpsSample = { t: number; v: number };
type TpsHourly = { h: string; avg: number; max: number; min: number; n: number };
type TpsHistory = { samples: TpsSample[]; hourly: TpsHourly[] };

const tpsHistoryFile = path.join(process.cwd(), "data", "tps-history.json");
const TPS_SAMPLE_INTERVAL_MS = 60 * 1000;
const TPS_BEE_CRITICAL_REFRESH_MS = 60 * 1000;
const TPS_RAW_RETENTION_MS = 24 * 60 * 60 * 1000;
const TPS_HOURLY_RETENTION_HOURS = 30 * 24;

function hourKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
}

function readTpsHistory(): TpsHistory {
  try {
    if (!fs.existsSync(tpsHistoryFile)) return { samples: [], hourly: [] };
    const parsed = JSON.parse(fs.readFileSync(tpsHistoryFile, "utf-8"));
    return {
      samples: Array.isArray(parsed?.samples) ? parsed.samples : [],
      hourly: Array.isArray(parsed?.hourly) ? parsed.hourly : [],
    };
  } catch {
    return { samples: [], hourly: [] };
  }
}

// Folds aged-out samples into hourly buckets. Like the mining rollup, folding
// REMOVES the samples it accounts for, so the two tiers never overlap.
function foldTpsHistory(history: TpsHistory, now: number): TpsHistory {
  const cutoff = now - TPS_RAW_RETENTION_MS;
  const buckets = new Map<string, TpsHourly>();
  for (const bucket of history.hourly) {
    if (bucket?.h) buckets.set(bucket.h, bucket);
  }

  const kept: TpsSample[] = [];

  for (const sample of history.samples) {
    if (!sample || typeof sample.t !== "number" || typeof sample.v !== "number") continue;

    if (sample.t >= cutoff) {
      kept.push(sample);
      continue;
    }

    const key = hourKey(sample.t);
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { h: key, avg: sample.v, max: sample.v, min: sample.v, n: 1 });
    } else {
      const n = bucket.n + 1;
      bucket.avg = Math.round(((bucket.avg * bucket.n + sample.v) / n) * 10) / 10;
      bucket.max = Math.max(bucket.max, sample.v);
      bucket.min = Math.min(bucket.min, sample.v);
      bucket.n = n;
    }
  }

  const oldestHour = hourKey(now - TPS_HOURLY_RETENTION_HOURS * 60 * 60 * 1000);

  return {
    samples: kept,
    hourly: [...buckets.values()]
      .filter((bucket) => bucket.h >= oldestHour)
      .sort((a, b) => (a.h < b.h ? -1 : 1)),
  };
}

const TPS_MIN_SAMPLE_GAP_MS = 45 * 1000;

function recordTpsSample(tps: number) {
  try {
    ensureStorage();
    const now = Date.now();
    const history = readTpsHistory();

    // Guard against double-recording rather than against stale reads. The
    // earlier version skipped whenever getAckiNetworkStats served from cache,
    // which meant any visitor hitting /api/radar/stats just before a tick
    // silently cost us that sample — the series thinned out as traffic grew.
    // A value up to the cache TTL old is fine for a 24h average; a missing
    // sample is not.
    const last = history.samples[history.samples.length - 1];
    if (last && now - last.t < TPS_MIN_SAMPLE_GAP_MS) return;

    history.samples.push({ t: now, v: tps });
    const folded = foldTpsHistory(history, now);
    fs.writeFileSync(tpsHistoryFile, JSON.stringify(folded), "utf-8");
  } catch (error) {
    console.error("recordTpsSample failed:", error);
  }
}

type TpsWindow = { avg: number; peak: number; min: number; samples: number } | null;

function summariseWindow(
  history: TpsHistory,
  sinceMs: number,
  now: number,
): TpsWindow {
  let sum = 0;
  let weight = 0;
  let peak = -Infinity;
  let min = Infinity;

  for (const sample of history.samples) {
    if (sample.t < sinceMs) continue;
    sum += sample.v;
    weight += 1;
    peak = Math.max(peak, sample.v);
    min = Math.min(min, sample.v);
  }

  // Hourly buckets only exist for hours already dropped from samples, so this
  // cannot double-count. Each bucket is weighted by how many samples it holds.
  const sinceHour = hourKey(sinceMs);
  const rawFromHour = hourKey(now - TPS_RAW_RETENTION_MS);
  for (const bucket of history.hourly) {
    if (bucket.h < sinceHour || bucket.h >= rawFromHour) continue;
    sum += bucket.avg * bucket.n;
    weight += bucket.n;
    peak = Math.max(peak, bucket.max);
    min = Math.min(min, bucket.min);
  }

  if (!weight) return null;

  return {
    avg: Math.round((sum / weight) * 10) / 10,
    peak: Math.round(peak * 10) / 10,
    min: Math.round(min * 10) / 10,
    samples: weight,
  };
}

function getTpsHistorySummary() {
  const now = Date.now();
  const history = readTpsHistory();

  // Sparkline: last 24h condensed to at most 48 points so the payload stays
  // small no matter how long the sampler has been running.
  const recent = history.samples.filter((s) => s.t >= now - TPS_RAW_RETENTION_MS);
  const step = Math.max(1, Math.ceil(recent.length / 48));
  const series: number[] = [];
  for (let i = 0; i < recent.length; i += step) {
    const slice = recent.slice(i, i + step);
    const avg = slice.reduce((sum, s) => sum + s.v, 0) / slice.length;
    series.push(Math.round(avg * 10) / 10);
  }

  return {
    h24: summariseWindow(history, now - 24 * 60 * 60 * 1000, now),
    d7: summariseWindow(history, now - 7 * 24 * 60 * 60 * 1000, now),
    series,
    sampleCount: history.samples.length,
    hourlyCount: history.hourly.length,
  };
}

// One owner for the expensive blocks(last:300) read. Successful reads keep the
// normal one-minute cadence; transient GraphQL failures back off instead of
// adding more pressure to an already exhausted public connection pool.
function startTpsSampler() {
  const FIRST_DELAY_MS = 5000;
  const MAX_FAILURE_BACKOFF_MS = 60 * 1000;

  const tick = async () => {
    const startedAt = Date.now();
    let targetIntervalMs = TPS_SAMPLE_INTERVAL_MS;
    const beeCritical = isBeeChainCritical();
    const criticalRefreshAnchorMs = Math.max(
      lastGoodChainStats?.atMs || 0,
      chainStatsLastAttemptAtMs || 0,
    );
    const criticalRefreshDue =
      !criticalRefreshAnchorMs ||
      startedAt - criticalRefreshAnchorMs >= TPS_BEE_CRITICAL_REFRESH_MS;

    try {
      if (!beeCritical || criticalRefreshDue) {
        chainStatsLastAttemptAtMs = startedAt;
        chainStatsLastBlockedByBee = false;
        const stats = await getAckiNetworkStats();

        // This sampler is the single owner of the expensive network-stats read.
        // Public HTTP traffic must consume this snapshot instead of triggering
        // its own blocks(last:300) GraphQL query.
        storeChainStatsSnapshot(stats);
        chainStatsConsecutiveFailures = 0;

        if (stats && typeof stats.tps === "number") {
          recordTpsSample(stats.tps);
        }
      } else {
        chainStatsLastBlockedByBee = true;
        // The normal tick may land just before the one-minute
        // boundary. Wake again at the exact boundary instead of slipping the
        // real request into the following minute.
        targetIntervalMs = Math.min(
          targetIntervalMs,
          Math.max(
            1000,
            criticalRefreshAnchorMs + TPS_BEE_CRITICAL_REFRESH_MS - startedAt,
          ),
        );
      }
    } catch (error) {
      chainStatsConsecutiveFailures += 1;
      const exponent = Math.min(3, Math.max(0, chainStatsConsecutiveFailures - 1));
      const baseBackoffMs = Math.min(
        MAX_FAILURE_BACKOFF_MS,
        TPS_SAMPLE_INTERVAL_MS * 2 ** exponent,
      );
      // Small jitter prevents this process from repeatedly landing on the same
      // busy boundary as other public-index consumers.
      targetIntervalMs = Math.min(
        MAX_FAILURE_BACKOFF_MS,
        Math.round(baseBackoffMs * (0.9 + Math.random() * 0.2)),
      );

      if (chainStatsConsecutiveFailures === 1 || chainStatsConsecutiveFailures % 3 === 0) {
        console.warn("TPS sampler GraphQL backoff:", {
          failures: chainStatsConsecutiveFailures,
          retrySeconds: Math.round(targetIntervalMs / 1000),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const delay = Math.max(1000, targetIntervalMs - elapsedMs);
    chainStatsNextAttemptAtMs = Date.now() + delay;
    setTimeout(tick, delay);
  };

  chainStatsNextAttemptAtMs = Date.now() + FIRST_DELAY_MS;
  setTimeout(tick, FIRST_DELAY_MS);
  console.log("TPS sampler started:", {
    intervalSeconds: TPS_SAMPLE_INTERVAL_MS / 1000,
    maxBackoffSeconds: MAX_FAILURE_BACKOFF_MS / 1000,
    beeCriticalRefreshSeconds: TPS_BEE_CRITICAL_REFRESH_MS / 1000,
    restoredSnapshot: Boolean(lastGoodChainStats),
  });
}

function getMiningMonitorWalletCount(): number {
  try {
    const stateFile = path.join(process.cwd(), "data", "mining-monitor.json");

    if (!fs.existsSync(stateFile)) {
      return 0;
    }

    const raw = fs.readFileSync(stateFile, "utf-8");

    if (!raw.trim()) {
      return 0;
    }

    const state = JSON.parse(raw);
    const watches = Array.isArray(state?.watches) ? state.watches : [];
    const uniqueAddresses = new Set(
      watches
        .map((watch: any) => String(watch?.address || "").trim().toLowerCase())
        .filter(Boolean),
    );

    return uniqueAddresses.size;
  } catch (error) {
    console.error("getMiningMonitorWalletCount failed:", error);
    return 0;
  }
}

function renderMiniAppHtml() {
  return `
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
   <title>Web3hunter Mining</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b1220;
        --card: #111827;
        --card2: #172033;
        --text: #f9fafb;
        --muted: #9ca3af;
        --line: rgba(255,255,255,.08);
        --accent: #facc15;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: Arial, sans-serif;
        background:
          radial-gradient(circle at top, rgba(250,204,21,.16), transparent 34%),
          var(--bg);
        color: var(--text);
      }

      .wrap {
        width: min(520px, 100%);
        margin: 0 auto;
        padding: 18px 16px 28px;
      }

      .hero {
        padding: 22px;
        border-radius: 28px;
        background: linear-gradient(145deg, rgba(250,204,21,.16), rgba(17,24,39,.96));
        border: 1px solid var(--line);
        box-shadow: 0 20px 70px rgba(0,0,0,.32);
      }

      .badge {
        display: inline-flex;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(250,204,21,.12);
        border: 1px solid rgba(250,204,21,.22);
        color: #fde68a;
        font-size: 13px;
        font-weight: 700;
      }

      h1 {
        margin: 18px 0 8px;
        font-size: 30px;
        letter-spacing: -0.04em;
      }

      h3 {
        margin: 0 0 12px;
      }

      .muted {
        color: var(--muted);
        line-height: 1.5;
      }

      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-top: 16px;
      }

      .card {
        padding: 16px;
        border-radius: 22px;
        background: rgba(17,24,39,.82);
        border: 1px solid var(--line);
      }

      .label {
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
      }

      .value {
        font-size: 22px;
        font-weight: 800;
      }

      .section {
        margin-top: 14px;
        padding: 18px;
        border-radius: 24px;
        background: rgba(17,24,39,.74);
        border: 1px solid var(--line);
      }

      .row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 0;
        border-bottom: 1px solid var(--line);
      }

      .row:last-child {
        border-bottom: 0;
      }

      .leader {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 11px 0;
        border-bottom: 1px solid var(--line);
      }

      .leader:last-child {
        border-bottom: 0;
      }

      .btn {
        width: 100%;
        margin-top: 14px;
        border: 0;
        border-radius: 18px;
        padding: 15px 16px;
        background: var(--accent);
        color: #111827;
        font-weight: 900;
        font-size: 15px;
        cursor: pointer;
      }

      .btn.secondary {
        background: #1f2937;
        color: white;
        border: 1px solid var(--line);
      }
.task-btn {
  border: 0;
  border-radius: 12px;
  padding: 9px 12px;
  background: var(--accent);
  color: #111827;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}
      code {
        display: block;
        margin-top: 10px;
        padding: 12px;
        border-radius: 14px;
        background: #0b1220;
        color: #fde68a;
        overflow-wrap: anywhere;
      }

      .empty {
        text-align: center;
        color: var(--muted);
        padding: 26px 10px;
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="hero">
        <span class="badge">🐝 Web3hunter Mining</span>
        <h1>Web3hunter Mining</h1>
        <p class="muted">Bot, puan, referans ve mining simülasyonu tek ekranda.</p>

        <div class="grid">
          <div class="card">
            <div class="label">Toplam Kullanıcı</div>
            <div class="value" id="totalUsers">-</div>
          </div>
          <div class="card">
            <div class="label">Toplam Puan</div>
            <div class="value" id="totalPoints">-</div>
          </div>
        </div>
      </section>

      <section class="section">
        <h3>👤 Profil</h3>
        <div id="profile" class="empty">Veri yükleniyor...</div>
      </section>

      <section class="section">
        <h3>⛏️ Mining</h3>
        <div id="mining" class="empty">Veri yükleniyor...</div>
      </section>

      <section class="section">
        <h3>🏆 Liderlik</h3>
        <div id="leaderboard" class="empty">Veri yükleniyor...</div>
      </section>
<section class="section">
  <section class="section">
  <h3>📋 Görevler</h3>
  <div id="tasks" class="empty">Veri yükleniyor...</div>
</section>
      <section class="section">
        <h3>🔗 Referans</h3>
        <p class="muted">Bot içindeki referans linkin burada da görünür.</p>
        <code id="referral">Yükleniyor...</code>
      </section>

      <button class="btn" onclick="reloadData()">Yenile</button>
      <button class="btn secondary" onclick="closeApp()">Kapat</button>
    </main>

    <script>
      const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

      if (tg) {
        tg.ready();
        tg.expand();
      }

      const urlParams = new URLSearchParams(window.location.search);
      const queryUserId = urlParams.get("userId");
      const telegramUserId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : null;
      const currentUserId = queryUserId || telegramUserId;

      async function fetchJson(url, options) {
  const res = await fetch(url, options);

  if (!res.ok) {
    throw new Error("API hatası: " + res.status);
  }

  return res.json();
}

      function setText(id, value) {
        document.getElementById(id).textContent = value;
      }

      function renderProfile(user) {
        if (!user) {
          document.getElementById("profile").innerHTML = '<div class="empty">Kullanıcı bulunamadı. Önce botta /start yaz.</div>';
          return;
        }

        var html = "";
        html += '<div class="row"><span>İsim</span><strong>' + user.firstName + '</strong></div>';
        html += '<div class="row"><span>Kullanıcı</span><strong>' + (user.username ? "@" + user.username : "-") + '</strong></div>';
        html += '<div class="row"><span>Puan</span><strong>' + user.points + '</strong></div>';
        html += '<div class="row"><span>Claim</span><strong>' + (user.lastClaimDate || "-") + '</strong></div>';

        document.getElementById("profile").innerHTML = html;
        setText("referral", user.referralLink || "-");
      }

      function renderMining(mining) {
        var html = "";
        html += '<div class="row"><span>Durum</span><strong>' + (mining.active ? "Aktif ✅" : "Pasif") + '</strong></div>';
        html += '<div class="row"><span>Süre</span><strong>' + mining.minutes + ' dk</strong></div>';
        html += '<div class="row"><span>Güç</span><strong>%' + mining.power + '</strong></div>';
        html += '<div class="row"><span>Katkı</span><strong>' + mining.hash + ' hash</strong></div>';

        document.getElementById("mining").innerHTML = html;
      }

      function renderLeaderboard(users) {
        if (!users.length) {
          document.getElementById("leaderboard").innerHTML = '<div class="empty">Henüz liderlik verisi yok.</div>';
          return;
        }

        var html = users.map(function(user, index) {
          var name = user.username ? "@" + user.username : user.firstName;

          return '<div class="leader"><span>' + (index + 1) + '. ' + name + '</span><strong>' + user.points + '</strong></div>';
        }).join("");

        document.getElementById("leaderboard").innerHTML = html;
      }
function renderTasks(tasks) {
  var target = document.getElementById("tasks");

  if (!target) {
    return;
  }

  if (!tasks || !tasks.length) {
    target.innerHTML = '<div class="empty">Henüz görev yok.</div>';
    return;
  }

  var html = tasks.map(function(task) {
    var action = task.completed
      ? '<strong>✅ Tamamlandı</strong>'
      : '<button class="task-btn" data-task-id="' + task.id + '">Tamamla</button>';

    return ''
      + '<div class="row">'
      + '<span>' + task.title + '<br><small class="muted">+' + task.reward + ' puan</small></span>'
      + action
      + '</div>';
  }).join("");

  target.innerHTML = html;

  var buttons = target.querySelectorAll(".task-btn");

  buttons.forEach(function(button) {
    button.addEventListener("click", function() {
      completeTaskFromDashboard(button.getAttribute("data-task-id"));
    });
  });
}

async function completeTaskFromDashboard(taskId) {
  if (!currentUserId) {
    alert("Kullanıcı ID bulunamadı.");
    return;
  }

  const result = await fetchJson(
    "/api/tasks/" + currentUserId + "/" + taskId + "/complete",
    {
      method: "POST",
    }
  );

  if (result && result.message) {
    console.log(result.message);
  }

  await reloadData();
}
      async function reloadData() {
        const stats = await fetchJson("/api/stats");
        setText("totalUsers", stats.totalUsers);
        setText("totalPoints", stats.totalPoints);

        const leaderboard = await fetchJson("/api/leaderboard");
        renderLeaderboard(leaderboard.users);

        if (currentUserId) {
          const profile = await fetchJson("/api/users/" + currentUserId);
          renderProfile(profile.user);
          renderMining(profile.mining);

       const tasks = await fetchJson("/api/tasks/" + currentUserId);
       renderTasks(tasks.tasks);
        } else {
          document.getElementById("profile").innerHTML = '<div class="empty">Telegram içinden açılmadı. Test için URL sonuna ?userId=TELEGRAM_ID ekle.</div>';
          document.getElementById("mining").innerHTML = '<div class="empty">Kullanıcı ID bekleniyor.</div>';
      document.getElementById("tasks").innerHTML = '<div class="empty">Kullanıcı ID bekleniyor.</div>';
        }
      }

      function closeApp() {
        if (tg) {
          tg.close();
          return;
        }

        window.close();
      }

     reloadData().catch(function(error) {
  console.error(error);
  document.body.innerHTML = '<main class="wrap"><section class="section"><h2>Hata</h2><p class="muted">Veriler yüklenemedi.</p><code>' + error.message + '</code></section></main>';
});
    </script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Web dashboard (ackinackiradar.com): Telegram Login + cloud mining + plans.
// Reuses the EXACT same data files the Telegram bot writes
// (data/bee-miners.json, data/payments.json), so a wallet connected via the
// bot shows up on the website and vice versa — one source of truth, two
// front doors.
// ---------------------------------------------------------------------------

const beeMinerFile = path.join(dataDir, "bee-miners.json");
const beeDiagnosticsFile = path.join(
  dataDir,
  "bee-epoch-diagnostics.jsonl",
);
const paymentsFile = path.join(dataDir, "payments.json");

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
  lastSessionAt: string | null;
  lastTapsSent: number | null;
  lastRewardAt: string | null;
  // Written by the mining tick in bot.ts; optional here because records
  // created before those fields existed will not have them.
  lastSessionStartedAt?: string | null;
  lastTapSum?: number | null;
  lastTapSumAt?: string | null;
  lastEpoch5mStart?: string | null;
  lastEpoch5mChangedAt?: string | null;
  lastSessionEpoch5mStart?: string | null;
  lastSessionEpochStatus?: "pending" | "accepted" | "tap_sum" | "failed" | null;
  lastClaimedEpoch5mStart?: string | null;
  lastClaimSubmittedAt?: string | null;
  createdAt: string;
};

type BeeMinerState = { miners: BeeMinerRecord[] };

// Cycle limits as described by the network: mining ends after 16 hours or
// 12,000 taps, whichever comes first, then a 24h wait before a new epoch.
// Exposed to the dashboard so it can show progress rather than guess.
const BEE_CYCLE_TAP_CAP = Number(process.env.BEE_CYCLE_TAP_CAP || 12000);

// --- Live reward feed, sampled straight off chain -------------------------
//
// The dashboard's reward monitor deliberately does NOT reuse the bot's stored
// mining-monitor events. Those are chain-derived too, but they are produced by
// a scan that cursors through ~175 wallets, so a reward can surface minutes
// after it landed — the lag the user kept seeing.
//
// The chain does not expose a per-reward amount: `in_message` is null on this
// endpoint and a transaction's `credit` is the message's SHELL value, not the
// NACKL. The only usable signal is the cumulative locked NACKL held as an
// extra currency (`balance_other`, currency id 1) on the wallet's popitGame
// account. So sample that total on a tight cadence and difference it; each
// positive step is one reward.
// The public block index is a shared, capacity-limited service. Keep one
// durable snapshot so a GraphQL pool timeout or an app restart degrades to an
// explicitly stale reading instead of blank tiles and a false "synchronised"
// state. A day-old snapshot is no longer useful enough to render.
const CHAIN_STATS_WARN_STALE_MS = 75 * 1000;
const CHAIN_STATS_MAX_SERVE_MS = 24 * 60 * 60 * 1000;
const chainStatsSnapshotFile = path.join(dataDir, "chain-stats-snapshot.json");

type ChainStatsSnapshot = { data: any; atMs: number };

function readChainStatsSnapshot(): ChainStatsSnapshot | null {
  try {
    if (!fs.existsSync(chainStatsSnapshotFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(chainStatsSnapshotFile, "utf-8"));
    const atMs = Number(parsed?.atMs);
    const latestBlock = Number(parsed?.data?.latestBlock);

    if (
      !Number.isFinite(atMs) ||
      atMs <= 0 ||
      !Number.isFinite(latestBlock) ||
      latestBlock <= 0
    ) {
      return null;
    }

    return { data: parsed.data, atMs };
  } catch {
    return null;
  }
}

function storeChainStatsSnapshot(data: any): void {
  const snapshot: ChainStatsSnapshot = { data, atMs: Date.now() };
  lastGoodChainStats = snapshot;

  try {
    ensureStorage();
    const temporaryFile = `${chainStatsSnapshotFile}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(snapshot), "utf-8");
    fs.renameSync(temporaryFile, chainStatsSnapshotFile);
  } catch (error) {
    console.error("Chain stats snapshot write failed:", error);
  }
}

let lastGoodChainStats: ChainStatsSnapshot | null = readChainStatsSnapshot();
let chainStatsConsecutiveFailures = 0;
let chainStatsNextAttemptAtMs: number | null = null;
let chainStatsLastAttemptAtMs: number | null = null;
let chainStatsLastBlockedByBee = false;

// The dashboard calls the feed stale past 60s, so force a read before that.
const REWARD_FEED_FORCE_READ_AFTER_MS = 45 * 1000;
// Bee owns the shared chain endpoint for the whole 135-second session. A
// reward from the preceding claim can therefore become visible while that
// lease is active. Allow exactly one tiny account read in the middle of each
// mining lease: late enough to avoid a long-running claim, and early enough
// to stay well clear of the root/proof submission near the session boundary.
const REWARD_FEED_CRITICAL_SAFE_MIN_AGE_MS = 60 * 1000;
const REWARD_FEED_CRITICAL_SAFE_MAX_AGE_MS = 100 * 1000;

// Reward confirmation is only interesting after a successful claim submission.
// Stop polling an old claim before the next normal five-minute reward cycle.
const REWARD_FEED_CLAIM_WINDOW_MS = Number(
  process.env.REWARD_FEED_CLAIM_WINDOW_MS || 4 * 60 * 1000,
);

const rewardFeedPollRaw = Number(process.env.REWARD_FEED_POLL_MS || 15000);
// The reward feed is a small, per-miner chain read. Keep it responsive without
// allowing an accidental zero/very-low environment value to hammer the RPC.
const REWARD_FEED_POLL_MS = Number.isFinite(rewardFeedPollRaw)
  ? Math.max(10_000, Math.floor(rewardFeedPollRaw))
  : 15_000;
/*
 * PHASE_7I_20260816
 *
 * The old dashboard retained only the last 100
 * reward rows. A normal mining cycle can contain
 * far more than that.
 *
 * 4096 is a safety ceiling, not a UI page limit.
 * The feed is explicitly cleared at the next cycle
 * boundary, therefore a complete cycle fits here.
 */
const REWARD_FEED_MAX = 4096;
const REWARD_NACKL_CURRENCY = 1;

type RewardTick = { at: string; amount: number };
// HEALTH_REWARD_CYCLE_FIX_20260814
type RewardCycleState = {
  baselineTotal: number;
  count: number;
  lastTapSum: number | null;
  startedAt: string | null;
  partial: boolean;
};

type RewardFeedState = {
  lastTotals: Record<string, number>;
  feeds: Record<string, RewardTick[]>;
  cycles: Record<string, RewardCycleState>;
};

const rewardFeedFile = path.join(process.cwd(), "data", "reward-feed.json");

function readRewardFeedState(): RewardFeedState {
  try {
    const parsed = JSON.parse(fs.readFileSync(rewardFeedFile, "utf-8"));
    const lastTotals = Object.fromEntries(
      Object.entries(parsed?.lastTotals ?? {}).filter(
        ([, value]) => typeof value === "number" && Number.isFinite(value),
      ),
    ) as Record<string, number>;
    const feeds = Object.fromEntries(
      Object.entries(parsed?.feeds ?? {}).map(([walletName, entries]) => [
        walletName,
        Array.isArray(entries)
          ? entries
              .filter(
                (entry: any) =>
                  typeof entry?.at === "string" &&
                  typeof entry?.amount === "number" &&
                  Number.isFinite(entry.amount),
              )
              .slice(-REWARD_FEED_MAX)
          : [],
      ]),
    ) as Record<string, RewardTick[]>;
    const rawCycles =
      parsed?.cycles &&
      typeof parsed.cycles === "object"
        ? parsed.cycles
        : {};

    const cycles = Object.fromEntries(
      Object.entries(feeds).map(
        ([walletName, entries]) => {
          const raw: any =
            (rawCycles as any)[walletName];

          if (
            raw &&
            typeof raw.baselineTotal === "number" &&
            Number.isFinite(raw.baselineTotal)
          ) {
            return [
              walletName,
              {
                baselineTotal:
                  raw.baselineTotal,

                count:
                  typeof raw.count === "number" &&
                  Number.isFinite(raw.count)
                    ? Math.max(
                        0,
                        Math.floor(raw.count),
                      )
                    : 0,

                lastTapSum:
                  typeof raw.lastTapSum === "number" &&
                  Number.isFinite(raw.lastTapSum)
                    ? raw.lastTapSum
                    : null,

                startedAt:
                  typeof raw.startedAt === "string"
                    ? raw.startedAt
                    : null,

                partial:
                  raw.partial === true,
              } as RewardCycleState,
            ];
          }

          const visibleSum =
            entries.reduce(
              (sum, entry) =>
                sum +
                (
                  Number(entry.amount) ||
                  0
                ),
              0,
            );

          const chainTotal =
            Number(
              lastTotals[walletName]
            );

          return [
            walletName,
            {
              baselineTotal:
                Number.isFinite(chainTotal)
                  ? Math.max(
                      0,
                      chainTotal -
                        visibleSum,
                    )
                  : 0,

              count:
                entries.length,

              lastTapSum:
                null,

              startedAt:
                entries[0]?.at ??
                null,

              partial:
                entries.length > 0,
            } as RewardCycleState,
          ];
        },
      ),
    ) as Record<
      string,
      RewardCycleState
    >;

    return {
      lastTotals,
      feeds,
      cycles,
    };

  } catch {
    return {
      lastTotals: {},
      feeds: {},
      cycles: {},
    };
  }
}

const storedRewardFeedState = readRewardFeedState();
const rewardFeed = new Map<string, RewardTick[]>(
  Object.entries(storedRewardFeedState.feeds),
);
const rewardLastTotal = new Map<string, number>(
  Object.entries(storedRewardFeedState.lastTotals),
);

const rewardCycleState =
  new Map<string, RewardCycleState>(
    Object.entries(
      storedRewardFeedState.cycles
    ),
  );
const rewardLastChainReadAt = new Map<string, string>();
let rewardLastForcedLeaseKey: string | null = null;
let rewardFeedPollInFlight = false;

// walletName -> last claim timestamp whose reward delta was already observed.
// This is intentionally in memory: after a process restart the worst case is
// one harmless re-check of a still-recent claim.
const rewardHandledClaimAt = new Map<string, string>();

function shouldForceRewardReadDuringBeeCritical(
  miners: BeeMinerRecord[],
): boolean {
  try {
    const leaseFile = path.join(
      process.cwd(),
      "data",
      "bee-chain-critical.json",
    );
    const lease = JSON.parse(fs.readFileSync(leaseFile, "utf-8"));
    const enteredAtMs = Date.parse(String(lease?.enteredAt || ""));
    const expiresAtMs = Number(lease?.expiresAt || 0);
    const now = Date.now();

    if (
      !Number.isFinite(enteredAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= now
    ) {
      return false;
    }

    const leaseAgeMs = now - enteredAtMs;
    if (
      leaseAgeMs < REWARD_FEED_CRITICAL_SAFE_MIN_AGE_MS ||
      leaseAgeMs > REWARD_FEED_CRITICAL_SAFE_MAX_AGE_MS
    ) {
      return false;
    }

    const leaseKey = `${String(lease?.owner || "unknown")}:${String(
      lease?.enteredAt || "",
    )}`;
    if (rewardLastForcedLeaseKey === leaseKey) {
      return false;
    }

    const hasStaleRewardRead = miners.some((miner) => {
      const lastReadAtMs = Date.parse(
        rewardLastChainReadAt.get(miner.walletName) || "",
      );
      return (
        !Number.isFinite(lastReadAtMs) ||
        now - lastReadAtMs >= REWARD_FEED_FORCE_READ_AFTER_MS
      );
    });

    if (!hasStaleRewardRead) {
      return false;
    }

    // Mark before issuing the request. If the public endpoint times out, do
    // not retry inside the same mining lease and risk drifting into submit.
    rewardLastForcedLeaseKey = leaseKey;
    return true;
  } catch {
    return false;
  }
}

function writeRewardFeedState(): void {
  const state: RewardFeedState = {
    lastTotals:
      Object.fromEntries(
        rewardLastTotal
      ),

    feeds:
      Object.fromEntries(
        rewardFeed
      ),

    cycles:
      Object.fromEntries(
        rewardCycleState
      ),
  };
  fs.writeFileSync(rewardFeedFile, JSON.stringify(state, null, 2), "utf-8");
}

async function readLockedNackl(popitGameAddress: string): Promise<number | null> {
  const accountId = popitGameAddress.replace(/^0:/, "");

  try {
    const res = await fetch("https://mainnet.ackinacki.org/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{blockchain{account(account_id:"${accountId}",dapp_id:"0000000000000000000000000000000000000000000000000000000000000001"){info{balance_other{currency value}}}}}`,
      }),
      signal: AbortSignal.timeout(20000),
    });

    const json: any = await res.json();
    const other = json?.data?.blockchain?.account?.info?.balance_other;

    if (!Array.isArray(other)) {
      return null;
    }

    const entry = other.find(
      (o: any) => Number(o?.currency) === REWARD_NACKL_CURRENCY,
    );

    return entry ? Number(BigInt(entry.value)) / 1e9 : null;
  } catch {
    // `pool timed out` is routine on this endpoint; skip the sample rather
    // than logging noise or inventing a data point.
    return null;
  }
}

// walletName -> popitGameAddress. Same mtime+size caching as
// getRadarMiningStats: mining-monitor.json is multi-megabyte and the poller
// runs every 30s, so re-parsing it each tick would be wasteful.
let rewardWatchCache: { key: string; data: Map<string, string> } | null = null;

function readMiningWatchesForRewards(): Map<string, string> {
  const stateFile = path.join(process.cwd(), "data", "mining-monitor.json");
  const empty = new Map<string, string>();

  try {
    if (!fs.existsSync(stateFile)) return empty;

    const stat = fs.statSync(stateFile);
    const key = `${stat.mtimeMs}:${stat.size}`;

    if (rewardWatchCache && rewardWatchCache.key === key) {
      return rewardWatchCache.data;
    }

    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const map = new Map<string, string>();

    for (const watch of parsed?.watches ?? []) {
      if (watch?.label && watch?.popitGameAddress) {
        map.set(String(watch.label), String(watch.popitGameAddress));
      }
    }

    rewardWatchCache = { key, data: map };
    return map;
  } catch {
    return empty;
  }
}

function rewardClaimNeedsCheck(
  miner: BeeMinerRecord,
  now: number,
): boolean {
  const claimAt = String(miner.lastClaimSubmittedAt || "").trim();

  if (!claimAt) {
    return false;
  }

  const claimAtMs = Date.parse(claimAt);

  if (!Number.isFinite(claimAtMs)) {
    return false;
  }

  const ageMs = now - claimAtMs;

  if (ageMs < 0 || ageMs > REWARD_FEED_CLAIM_WINDOW_MS) {
    return false;
  }

  // The chain delta for this exact claim was already observed.
  if (rewardHandledClaimAt.get(miner.walletName) === claimAt) {
    return false;
  }

  // Persisted miner state is stronger than the in-memory marker after restart.
  const rewardAtMs = Date.parse(String(miner.lastRewardAt || ""));

  if (Number.isFinite(rewardAtMs) && rewardAtMs >= claimAtMs) {
    rewardHandledClaimAt.set(miner.walletName, claimAt);
    return false;
  }

  return true;
}

async function pollRewardFeed(): Promise<void> {
  const miners = readBeeMinerState().miners.filter(
    (m) => m.status === "active",
  );

  if (!miners.length) {
    return;
  }

  const watches = readMiningWatchesForRewards();
  const now = Date.now();

  // Every newly activated miner needs one baseline. After that, only wallets
  // with a recent successful claim submission are eligible for provider reads.
  const targets = miners.filter((miner) => {
    if (!watches.has(miner.walletName)) {
      return false;
    }

    if (!rewardLastTotal.has(miner.walletName)) {
      return true;
    }

    return rewardClaimNeedsCheck(miner, now);
  });

  if (!targets.length) {
    return;
  }

  // Bee remains the priority owner of the shared endpoint. During a critical
  // lease we keep the existing single-safe-read exception, but only when there
  // is actually a baseline or claim that needs observation.
  if (
    isBeeChainCritical() &&
    !shouldForceRewardReadDuringBeeCritical(targets)
  ) {
    return;
  }

  for (const miner of targets) {
    const popit = watches.get(miner.walletName);

    if (!popit) {
      continue;
    }

    const total = await readLockedNackl(popit);

    if (total == null) {
      continue;
    }

    rewardLastChainReadAt.set(
      miner.walletName,
      new Date().toISOString(),
    );

    const previous =
      rewardLastTotal.get(
        miner.walletName
      );

    rewardLastTotal.set(
      miner.walletName,
      total,
    );

    const tapSum =
      typeof miner.lastTapSum === "number" &&
      Number.isFinite(
        miner.lastTapSum
      )
        ? miner.lastTapSum
        : null;

    let cycle =
      rewardCycleState.get(
        miner.walletName
      );

    if (!cycle) {
      const visible =
        rewardFeed.get(
          miner.walletName
        ) ?? [];

      const visibleSum =
        visible.reduce(
          (sum, entry) =>
            sum +
            (
              Number(entry.amount) ||
              0
            ),
          0,
        );

      cycle = {
        baselineTotal:
          previous != null
            ? Math.max(
                0,
                previous -
                  visibleSum,
              )
            : total,

        count:
          visible.length,

        lastTapSum:
          tapSum,

        startedAt:
          visible[0]?.at ??
          null,

        partial:
          visible.length > 0,
      };
    }

    let cycleChanged =
      false;

    // 12000 -> small value means the contract entered
    // the next mining cycle.
    if (
      tapSum !== null &&
      cycle.lastTapSum !== null &&
      tapSum + 1000 <
        cycle.lastTapSum
    ) {
      const previousTapSum =
        cycle.lastTapSum;

      cycle = {
        // "previous" is the cumulative locked NACKL before
        // the first reward observed in the new cycle.
        baselineTotal:
          previous ?? total,

        count: 0,

        lastTapSum:
          tapSum,

        startedAt:
          new Date()
            .toISOString(),

        partial:
          false,
      };

      cycleChanged =
        true;

      /*
       * PHASE_7I_CURRENT_CYCLE_FEED_RESET
       *
       * The summary baseline/count above is the
       * authoritative cycle total.
       *
       * Reward rows are only a visual history for
       * the CURRENT cycle, so discard the previous
       * cycle's rows at the same confirmed boundary.
       */
      rewardFeed.set(
        miner.walletName,
        [],
      );

      console.log(
        "Reward cycle reset detected:",
        {
          walletName:
            miner.walletName,

          previousTapSum,

          newTapSum:
            tapSum,
        },
      );

    } else if (
      tapSum !== null &&
      cycle.lastTapSum !==
        tapSum
    ) {
      cycle.lastTapSum =
        tapSum;

      cycleChanged =
        true;
    }

    rewardCycleState.set(
      miner.walletName,
      cycle,
    );

    // First successful read establishes a baseline only. Normally this happens
    // before the first claim because the miner spends minutes active before a
    // reward boundary.
    if (previous == null) {
      writeRewardFeedState();
      continue;
    }

    if (total <= previous) {
      if (
        total !== previous ||
        cycleChanged
      ) {
        writeRewardFeedState();
      }

      continue;
    }

    const rewardAt = new Date().toISOString();
    const rewardAmount = total - previous;
    const feed = rewardFeed.get(miner.walletName) ?? [];

    feed.push({
      at: rewardAt,
      amount: rewardAmount,
    });

    rewardFeed.set(
      miner.walletName,
      feed.slice(
        -REWARD_FEED_MAX
      ),
    );

    // Feed retains the complete current cycle (4096-row safety ceiling).
    // Cycle counter does NOT have that limit.
    cycle.count += 1;

    if (!cycle.startedAt) {
      cycle.startedAt =
        rewardAt;
    }

    rewardCycleState.set(
      miner.walletName,
      cycle,
    );

    const claimAt = String(
      miner.lastClaimSubmittedAt || "",
    ).trim();

    if (claimAt) {
      rewardHandledClaimAt.set(
        miner.walletName,
        claimAt,
      );
    }

    writeRewardFeedState();

    // A successful claim RPC only proves submission. The locked NACKL delta
    // observed here is the authoritative reward confirmation.
    const current = readBeeMinerState();
    const currentMiner = current.miners.find(
      (m) => m.id === miner.id,
    );

    if (currentMiner) {
      currentMiner.lastRewardAt = rewardAt;
      currentMiner.lastError = null;
      writeBeeMinerState(current);
    }

    console.log("Reward feed claim confirmed:", {
      walletName: miner.walletName,
      claimAt: claimAt || null,
      amount: rewardAmount,
      at: rewardAt,
    });
  }
}

// A slow chain response must never make a second overlapping request. Apart
// from avoiding needless load, this keeps two samples from racing each other
// and losing a positive balance delta.
async function runRewardFeedPoll(): Promise<void> {
  if (rewardFeedPollInFlight) return;
  rewardFeedPollInFlight = true;
  try {
    await pollRewardFeed();
  } finally {
    rewardFeedPollInFlight = false;
  }
}
const BEE_CYCLE_HOURS = Number(process.env.BEE_CYCLE_HOURS || 16);

type PendingInvoice = {
  id: string;
  chatId: number;
  planId: string;
  amountRaw: string;
  createdAt: string;
  expiresAt: string;
  currency?: "shell" | "usdt" | "nackl";
  code?: string;
  amountTonRaw?: string;
};

type Subscription = {
  planId: string;
  activeUntil: string;
  trial?: boolean;
};

type ReferralProfile = {
  code: string;
  createdAt: string;
};

type ReferralBinding = {
  referredChatId: number;
  referrerChatId: number;
  code: string;
  boundAt: string;
  qualifiedAt?: string | null;
  qualifiedPlanId?: string | null;
  paymentSource?: string | null;
};

type PaymentsState = {
  lastCheckedBalanceRaw: string | null;
  pendingInvoices: PendingInvoice[];
  subscriptions: Record<string, Subscription>;
  seenMessageIds: string[];
  seenNacklMessageIds?: string[];
  nacklBaselineReady?: boolean;
  trialUsed?: number[];
  starsCharges?: string[];
  tonLastLt?: number;

  // REFERRAL BACKEND STEP1
  referralProfiles?: Record<string, ReferralProfile>;
  referrals?: Record<string, ReferralBinding>;

  referralRewards?: Array<{
    referrerChatId: number;
    threshold: number;
    daysAdded: number;
    totalRewardDays: number;
    at: string;
  }>;
};

type DashboardMiningHealthStatus =
  | "healthy"
  | "warning"
  | "critical"
  | "idle";

type DashboardMiningHealthIssue =
  | "producer_queue_congestion"
  | "submission_proof_missing"
  | "chain_confirmation_timeout"
  | "session_rejected"
  | "sdk_error"
  | "claim_failed";

function readBeeMiningHealth(minerIds: Set<string>) {
  const empty = {
    available: false,
    status: "idle" as DashboardMiningHealthStatus,
    scope: "cycle" as const,
    windowHours: null as number | null,
    total: 0,
    confirmed: 0,
    healthy: 0,
    recovered: 0,
    pending: 0,
    lost: 0,
    claimIssues: 0,
    successRate: null as number | null,
    primaryIssue: null as {
      code: DashboardMiningHealthIssue;
      count: number;
    } | null,
    issueCounts: {} as Partial<
      Record<DashboardMiningHealthIssue, number>
    >,
    latest: [] as Array<{
      at: string;
      minerId: string;
      walletName: string;
      epoch5mStart: string;
      status: "healthy" | "recovered" | "pending" | "lost";
      issueCode: DashboardMiningHealthIssue | null;
      taps: number | null;
      tapDelta: number | null;
      retries: number;
      retryMode: string;
      settlement: string;
      rejected: boolean;
      queueOverflowRetriesObserved: number;
      queueOverflowExhaustedObserved: number;
      claim: "none" | "queued" | "failed" | "collected";
    }>,
  };

  if (!minerIds.size || !fs.existsSync(beeDiagnosticsFile)) {
    return empty;
  }

  try {
    // Read only the latest 2 MB so dashboard polling stays cheap even when
    // the append-only diagnostic history becomes large.
    const stat = fs.statSync(beeDiagnosticsFile);
    const maxBytes = 2 * 1024 * 1024;
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;

    if (length <= 0) {
      return { ...empty, available: true };
    }

    const fd = fs.openSync(beeDiagnosticsFile, "r");
    let text = "";

    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      text = buffer.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }

    // Tail read may start halfway through a JSONL record.
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }

    // No rolling 24h cutoff.
    // The latest large tapSum reset determines the current cycle.
    const cutoff = 0;

    const sessions: any[] = [];

    const claims = new Map<
      string,
      "queued" | "failed" | "collected"
    >();

    const lastTapHighByMiner =
      new Map<string, number>();

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);

        if (
          !event ||
          typeof event !== "object" ||
          !minerIds.has(String(event.minerId || ""))
        ) {
          continue;
        }

        const eventTime = Date.parse(String(event.at || ""));

        if (!Number.isFinite(eventTime) || eventTime < cutoff) {
          continue;
        }

        const key =
          `${String(event.minerId)}:${String(event.epoch5mStart || "")}`;

        if (
          event.type ===
          "session_finished"
        ) {
          const minerId =
            String(
              event.minerId ||
              ""
            );

          const values = [
            event.tapSumBefore,
            event.tapSumAfter,
          ]
            .filter(
              (value: any) =>
                typeof value ===
                  "number" &&
                Number.isFinite(
                  value
                ),
            )
            .map(
              (value: any) =>
                Number(value),
            );

          if (values.length) {
            const low =
              Math.min(
                ...values
              );

            const high =
              Math.max(
                ...values
              );

            const previousHigh =
              lastTapHighByMiner.get(
                minerId
              );

            // Large drop =
            // new 12k mining cycle.
            if (
              previousHigh != null &&
              low + 1000 <
                previousHigh
            ) {
              for (
                let i =
                  sessions.length - 1;
                i >= 0;
                i -= 1
              ) {
                if (
                  String(
                    sessions[i]
                      ?.minerId ||
                    ""
                  ) === minerId
                ) {
                  sessions.splice(
                    i,
                    1,
                  );
                }
              }

              for (
                const claimKey
                of Array.from(
                  claims.keys()
                )
              ) {
                if (
                  claimKey.startsWith(
                    `${minerId}:`
                  )
                ) {
                  claims.delete(
                    claimKey
                  );
                }
              }

              lastTapHighByMiner.set(
                minerId,
                high,
              );

            } else {
              lastTapHighByMiner.set(
                minerId,

                previousHigh == null
                  ? high
                  : Math.max(
                      previousHigh,
                      high,
                    ),
              );
            }
          }

          sessions.push(
            event
          );

        } else if (
          event.type ===
          "claim_queued"
        ) {
          claims.set(key, "queued");
        } else if (event.type === "claim_failed") {
          claims.set(key, "failed");
        } else if (event.type === "claim_collected") {
          claims.set(key, "collected");
        }
      } catch {
        // A partially written final JSONL row must never break the dashboard.
      }
    }

    let healthy = 0;
    let recovered = 0;
    let pending = 0;
    let lost = 0;

    const issueCounts =
      new Map<DashboardMiningHealthIssue, number>();

    for (
      let index = 0;
      index < sessions.length;
      index += 1
    ) {
      const session =
        sessions[index];

      let healthStatus:
        | "healthy"
        | "recovered"
        | "pending"
        | "lost";

      const sessionClaimState =
        claims.get(
          `${String(session.minerId || "")}:${String(session.epoch5mStart || "")}`,
        );

      if (
        session.result ===
        "healthy"
      ) {
        healthStatus =
          Number(
            session.retries ||
            0
          ) > 0
            ? "recovered"
            : "healthy";

      // A collected claim is chain-side proof that an earlier ambiguous
      // submission was accepted. Reconcile that final result instead of
      // leaving the session permanently in the dashboard's pending bucket.
      } else if (
        sessionClaimState ===
        "collected"
      ) {
        healthStatus =
          "recovered";

      } else {
        const tapDelta =
          typeof session.tapDelta ===
            "number" &&
          Number.isFinite(
            session.tapDelta
          )
            ? session.tapDelta
            : null;

        const baseline =
          typeof session.tapSumAfter ===
            "number" &&
          Number.isFinite(
            session.tapSumAfter
          )
            ? session.tapSumAfter
            :
          typeof session.tapSumBefore ===
            "number" &&
          Number.isFinite(
            session.tapSumBefore
          )
            ? session.tapSumBefore
            : null;

        // Immediate next session belonging
        // to the SAME miner.
        const next =
          sessions
            .slice(
              index + 1
            )
            .find(
              (row) =>
                String(
                  row.minerId ||
                  ""
                ) ===
                String(
                  session.minerId ||
                  ""
                ),
            );

        const nextBefore =
          next &&
          typeof next.tapSumBefore ===
            "number" &&
          Number.isFinite(
            next.tapSumBefore
          )
            ? next.tapSumBefore
            : null;

        const expected =
          Math.max(
            1,
            Number(
              session.taps ||
              70
            ),
          );

        // Example:
        // failed session ends on 10779,
        // next session starts on 10849.
        // +70 arrived late => NOT LOST.
        const delayed =
          baseline !== null &&
          nextBefore !== null &&
          nextBefore -
            baseline >=
            Math.max(
              1,
              Math.floor(
                expected *
                0.8
              ),
            );

        if (
          (
            tapDelta !== null &&
            tapDelta > 0
          ) ||
          delayed
        ) {
          healthStatus =
            "recovered";

        } else if (
          String(
            session.settlement ||
            ""
          ) === "timeout"
        ) {
          // Timeout only means our wait
          // window expired.
          healthStatus =
            "pending";

        } else if (
          session
            .sawSessionRejected ===
            true ||
          String(
            session.settlement ||
            ""
          ) === "sdk_error"
        ) {
          healthStatus =
            "lost";

        } else {
          healthStatus =
            "pending";
        }
      }

      session.__healthStatus =
        healthStatus;

      const queueOverflowRetriesObserved =
        Math.max(
          0,
          Number(
            session.queueOverflowRetriesObserved ||
            0,
          ),
        );

      const queueOverflowExhaustedObserved =
        Math.max(
          0,
          Number(
            session.queueOverflowExhaustedObserved ||
            0,
          ),
        );

      const eventErrorText =
        [
          session.error,
          ...(
            Array.isArray(session.eventErrors)
              ? session.eventErrors
              : []
          ),
        ]
          .filter(Boolean)
          .join(" ");

      let issueCode:
        DashboardMiningHealthIssue | null =
          null;

      if (
        healthStatus === "pending" ||
        healthStatus === "lost"
      ) {
        if (
          queueOverflowRetriesObserved > 0 ||
          queueOverflowExhaustedObserved > 0 ||
          /QUEUE_OVERFLOW|queue is full|message queue is full/i.test(
            eventErrorText,
          )
        ) {
          issueCode =
            "producer_queue_congestion";
        } else if (
          session.sawSessionRejected === true
        ) {
          issueCode =
            "session_rejected";
        } else if (
          String(session.settlement || "") ===
          "sdk_error"
        ) {
          issueCode =
            "sdk_error";
        } else if (
          session.sawSubmitProof !== true
        ) {
          issueCode =
            "submission_proof_missing";
        } else if (
          String(session.settlement || "") ===
          "timeout"
        ) {
          issueCode =
            "chain_confirmation_timeout";
        } else {
          issueCode =
            "sdk_error";
        }

        issueCounts.set(
          issueCode,
          (issueCounts.get(issueCode) || 0) + 1,
        );
      }

      session.__issueCode =
        issueCode;

      if (
        healthStatus ===
        "healthy"
      ) {
        healthy += 1;

      } else if (
        healthStatus ===
        "recovered"
      ) {
        recovered += 1;

      } else if (
        healthStatus ===
        "pending"
      ) {
        pending += 1;

      } else {
        lost += 1;
      }
    }

    let claimIssues = 0;

    for (const claimState of claims.values()) {
      if (claimState === "failed") {
        claimIssues += 1;
      }
    }

    if (claimIssues > 0) {
      issueCounts.set(
        "claim_failed",
        claimIssues,
      );
    }

    const confirmed = healthy + recovered;

    const total =
      confirmed + pending + lost;

    const finalized =
      confirmed + lost;

    const successRate =
      finalized > 0
        ? Number(
            ((confirmed / finalized) * 100).toFixed(2),
          )
        : null;

    const primaryIssueEntry =
      Array.from(issueCounts.entries())
        .sort(
          (left, right) =>
            right[1] - left[1],
        )[0];

    const primaryIssue =
      primaryIssueEntry
        ? {
            code: primaryIssueEntry[0],
            count: primaryIssueEntry[1],
          }
        : null;

    const finalizedSessions =
      sessions.filter(
        (session) =>
          session.__healthStatus !==
          "pending",
      );

    const lastSession =
      finalizedSessions.length > 0
        ? finalizedSessions[
            finalizedSessions.length -
            1
          ]
        : null;

    const status:
      DashboardMiningHealthStatus =
      lastSession &&
      lastSession.__healthStatus ===
        "lost"
        ? "critical"
        :
      lost > 0 ||
      claimIssues > 0 ||
      pending > 0
        ? "warning"
        :
      total > 0
        ? "healthy"
        : "idle";

    const latest = sessions
      .slice(-20)
      .reverse()
      .map((session) => {
        const retries = Number(session.retries || 0);

        const sessionStatus:
          | "healthy"
          | "recovered"
          | "pending"
          | "lost" =
          session.__healthStatus ===
            "lost"
            ? "lost"
            :
          session.__healthStatus ===
            "pending"
            ? "pending"
            :
          session.__healthStatus ===
            "recovered"
            ? "recovered"
            : "healthy";

        const key =
          `${String(session.minerId)}:${String(session.epoch5mStart || "")}`;

        return {
          at: String(session.at || session.endedAt || ""),
          minerId: String(session.minerId || ""),
          walletName: String(session.walletName || ""),
          epoch5mStart: String(session.epoch5mStart || ""),
          status: sessionStatus,
          issueCode:
            session.__issueCode ||
            null,
          taps:
            typeof session.taps === "number"
              ? session.taps
              : null,
          tapDelta:
            typeof session.tapDelta === "number"
              ? session.tapDelta
              : null,
          retries,
          retryMode: String(session.retryMode || "none"),
          settlement: String(session.settlement || "unknown"),
          rejected: session.sawSessionRejected === true,
          queueOverflowRetriesObserved:
            Math.max(
              0,
              Number(
                session.queueOverflowRetriesObserved ||
                0,
              ),
            ),
          queueOverflowExhaustedObserved:
            Math.max(
              0,
              Number(
                session.queueOverflowExhaustedObserved ||
                0,
              ),
            ),
          claim: claims.get(key) || "none",
        };
      });

    return {
      available: true,
      status,
      scope: "cycle" as const,
      windowHours: null,
      total,
      confirmed,
      healthy,
      recovered,
      pending,
      lost,
      claimIssues,
      successRate,
      primaryIssue,
      issueCounts:
        Object.fromEntries(
          issueCounts.entries(),
        ),
      latest,
    };
  } catch (error) {
    console.warn("readBeeMiningHealth failed:", {
      message:
        error instanceof Error
          ? error.message
          : String(error),
    });

    return empty;
  }
}

function readBeeMinerState(): BeeMinerState {
  ensureStorage();
  if (!fs.existsSync(beeMinerFile)) return { miners: [] };
  const raw = fs.readFileSync(beeMinerFile, "utf-8");
  if (!raw.trim()) return { miners: [] };
  const parsed = JSON.parse(raw);
  return { miners: Array.isArray(parsed?.miners) ? parsed.miners : [] };
}

function writeBeeMinerState(state: BeeMinerState) {
  ensureStorage();
  fs.writeFileSync(beeMinerFile, JSON.stringify(state, null, 2), "utf-8");
}

function readPaymentsState(): PaymentsState {
  ensureStorage();
  if (!fs.existsSync(paymentsFile)) {
    return { lastCheckedBalanceRaw: null, pendingInvoices: [], subscriptions: {}, seenMessageIds: [] };
  }
  const raw = fs.readFileSync(paymentsFile, "utf-8");
  if (!raw.trim()) {
    return { lastCheckedBalanceRaw: null, pendingInvoices: [], subscriptions: {}, seenMessageIds: [] };
  }
  const parsed = JSON.parse(raw);
  return {
    // Preserve bot-owned fields such as the NACKL settle cursors when the
    // dashboard writes referral metadata back to payments.json.
    ...parsed,
    lastCheckedBalanceRaw: parsed?.lastCheckedBalanceRaw ?? null,
    pendingInvoices: Array.isArray(parsed?.pendingInvoices) ? parsed.pendingInvoices : [],
    subscriptions: parsed?.subscriptions && typeof parsed.subscriptions === "object" ? parsed.subscriptions : {},
    seenMessageIds: Array.isArray(parsed?.seenMessageIds) ? parsed.seenMessageIds : [],
    seenNacklMessageIds: Array.isArray(parsed?.seenNacklMessageIds)
      ? parsed.seenNacklMessageIds
      : [],
    nacklBaselineReady: parsed?.nacklBaselineReady === true,
    trialUsed: Array.isArray(parsed?.trialUsed) ? parsed.trialUsed : [],
    starsCharges: Array.isArray(parsed?.starsCharges) ? parsed.starsCharges : [],
    tonLastLt: Number.isFinite(Number(parsed?.tonLastLt))
      ? Number(parsed.tonLastLt)
      : 0,
  };
}

function writePaymentsState(state: PaymentsState) {
  ensureStorage();
  fs.writeFileSync(paymentsFile, JSON.stringify(state, null, 2), "utf-8");
}

function allocateInvoiceAmountRaw(plan: Plan, state: PaymentsState): string {
  const usedAmounts = new Set(
    state.pendingInvoices.map((invoice) => String(invoice.amountRaw)),
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

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const SESSION_SECRET = process.env.DASHBOARD_SESSION_SECRET || BOT_TOKEN || "insecure-dev-secret";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// REFERRAL BACKEND STEP1
// This step creates referral profiles, links and permanent bindings only.
// Paid qualification and reward granting are connected in Step 2.
// ---------------------------------------------------------------------------

const REFERRAL_PUBLIC_BASE_URL = String(
  process.env.PUBLIC_BASE_URL ||
    "https://ackinackiradar.com",
).replace(/\/+$/, "");

const REFERRAL_MILESTONES = [
  {
    count: 1,
    totalDays: 15,
  },
  {
    count: 3,
    totalDays: 30,
  },
  {
    count: 9,
    totalDays: 90,
  },
] as const;


function makeReferralCode(
  chatId: number,
): string {
  return crypto
    .createHmac(
      "sha256",
      SESSION_SECRET,
    )
    .update(
      `referral:${chatId}`,
    )
    .digest(
      "base64url",
    )
    .slice(
      0,
      16,
    );
}


function ensureReferralProfile(
  state: PaymentsState,
  chatId: number,
): {
  profile: ReferralProfile;
  changed: boolean;
} {
  if (
    !state.referralProfiles ||
    typeof state.referralProfiles !==
      "object"
  ) {
    state.referralProfiles = {};
  }

  const key =
    String(chatId);

  const existing =
    state.referralProfiles[key];

  if (
    existing &&
    typeof existing.code ===
      "string" &&
    existing.code.length >= 8
  ) {
    return {
      profile: existing,
      changed: false,
    };
  }

  const profile: ReferralProfile = {
    code:
      makeReferralCode(chatId),

    createdAt:
      new Date().toISOString(),
  };

  state.referralProfiles[key] =
    profile;

  return {
    profile,
    changed: true,
  };
}


function findReferralOwnerByCode(
  state: PaymentsState,
  code: string,
): number | null {
  for (
    const [chatIdRaw, profile]
    of Object.entries(
      state.referralProfiles || {},
    )
  ) {
    if (
      profile?.code !== code
    ) {
      continue;
    }

    const chatId =
      Number(chatIdRaw);

    if (
      Number.isSafeInteger(chatId) &&
      chatId > 0
    ) {
      return chatId;
    }
  }

  return null;
}


function buildReferralDashboardState(
  state: PaymentsState,
  chatId: number,
) {
  const ensured =
    ensureReferralProfile(
      state,
      chatId,
    );

  const invited =
    Object.values(
      state.referrals || {},
    ).filter(
      (item) =>
        item &&
        item.referrerChatId ===
          chatId,
    );

  const qualified =
    invited.filter(
      (item) =>
        Boolean(
          item.qualifiedAt,
        ),
    );

  const rewards =
    (
      state.referralRewards || []
    ).filter(
      (item) =>
        item &&
        item.referrerChatId ===
          chatId,
    );

  const earnedDays =
    rewards.reduce(
      (sum, item) =>
        sum +
        Number(
          item.daysAdded || 0,
        ),
      0,
    );

  const next =
    REFERRAL_MILESTONES.find(
      (item) =>
        qualified.length <
        item.count,
    ) || null;

  return {
    changed:
      ensured.changed,

    data: {
      code:
        ensured.profile.code,

      link:
        REFERRAL_PUBLIC_BASE_URL +
        "/referrals?ref=" +
        encodeURIComponent(
          ensured.profile.code,
        ),

      invitedCount:
        invited.length,

      qualifiedCount:
        qualified.length,

      earnedDays,

      nextThreshold:
        next?.count ?? null,

      nextRewardTotalDays:
        next?.totalDays ?? null,

      completed:
        qualified.length >= 9,
    },
  };
}

const PAYMENTS_WALLET_NAME = process.env.PAYMENTS_WALLET_NAME || "ackinackiradarpayments";
const NACKL_PAYMENTS_WALLET_NAME =
  process.env.NACKL_PAYMENTS_WALLET_NAME || PAYMENTS_WALLET_NAME;
const NACKL_PAYMENTS_CHECK_ENABLED =
  String(process.env.NACKL_PAYMENTS_CHECK_ENABLED || "false").toLowerCase() ===
    "true" && Boolean(NACKL_PAYMENTS_WALLET_NAME);
const NACKL_INVOICE_EXPIRY_MS =
  Number(process.env.NACKL_INVOICE_EXPIRY_MINUTES || 120) * 60 * 1000;
const BEE_APP_ID = process.env.BEE_APP_ID || "";
// Same flag bot.ts uses to gate its payment-matching cron. /plan/buy must not
// issue a real invoice while that cron is off — no automated process would
// ever detect and credit a payment sent against it. Found 2026-08-08: the
// dashboard's Buy button was fully wired end to end with no such check, so a
// real user could have sent real SHELL that would never get reconciled.
const PAYMENTS_CHECK_ENABLED =
  String(process.env.PAYMENTS_CHECK_ENABLED || "false").toLowerCase() === "true";
// Same defaults the mining scheduler in bot.ts uses; read here only so the
// dashboard can turn a tap budget into an estimated remaining time.
const BEE_MINING_TAP_COUNT = Number(process.env.BEE_MINING_TAP_COUNT || 70);
const BEE_MINING_INTERVAL_SECONDS = Number(
  process.env.BEE_MINING_INTERVAL_SECONDS || 300,
);

// Verifies a Telegram Login Widget payload per Telegram's documented
// algorithm: https://core.telegram.org/widgets/login#checking-authorization
function verifyTelegramLoginPayload(data: Record<string, any>): boolean {
  if (!BOT_TOKEN) return false;

  const { hash, ...rest } = data;
  if (!hash) return false;

  const checkString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(BOT_TOKEN).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  if (!hasMatchingSignature(computedHash, hash)) return false;

  const authDate = Number(rest.auth_date) * 1000;
  if (!authDate || Date.now() - authDate > 24 * 60 * 60 * 1000) return false;

  return true;
}

function hasMatchingSignature(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function signSession(telegramId: number): string {
  const payload = JSON.stringify({ telegramId, exp: Date.now() + SESSION_TTL_MS });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${signature}`;
}

function verifySession(token: string): number | null {
  const [payloadB64, signature] = String(token || "").split(".");
  if (!payloadB64 || !signature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");

  if (!hasMatchingSignature(expectedSignature, signature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (!payload?.telegramId || Date.now() > payload.exp) return null;
    return Number(payload.telegramId);
  } catch {
    return null;
  }
}

// Telegram Mini Apps expose initDataUnsafe for convenience, but it is supplied
// by the client and must never be treated as proof of identity. The browser
// sends the signed initData value in a header and we verify it here using the
// algorithm documented by Telegram before authorizing the legacy profile and
// quest endpoints.
function verifyTelegramWebAppInitData(initData: string): number | null {
  if (!BOT_TOKEN || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) return null;

  params.delete("hash");

  const checkString = Array.from(params.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  if (!hasMatchingSignature(expectedHash, hash)) return null;

  const authDate = Number(params.get("auth_date")) * 1000;
  const now = Date.now();

  if (!Number.isFinite(authDate) || authDate > now + 60 * 1000) return null;
  if (now - authDate > 24 * 60 * 60 * 1000) return null;

  try {
    const user = JSON.parse(params.get("user") || "");
    const telegramId = Number(user?.id);

    return Number.isSafeInteger(telegramId) && telegramId > 0
      ? telegramId
      : null;
  } catch {
    return null;
  }
}

function getAuthenticatedTelegramId(req: any): number | null {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const sessionTelegramId = verifySession(token);
  const rawInitData = req.headers["x-telegram-init-data"];
  const initData = Array.isArray(rawInitData)
    ? String(rawInitData[0] || "")
    : String(rawInitData || "");
  return sessionTelegramId ?? verifyTelegramWebAppInitData(initData);
}

function requireUserAuth(req: any, res: any, next: any) {
  const telegramId = getAuthenticatedTelegramId(req);

  if (telegramId === null) {
    res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    return;
  }

  req.telegramId = telegramId;
  next();
}

function requireDashboardAuth(req: any, res: any, next: any) {
  const telegramId = getAuthenticatedTelegramId(req);

  if (telegramId === null) {
    res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    return;
  }

  req.telegramId = telegramId;
  next();
}

// Admin-only endpoints. Built on the same Telegram session as the dashboard —
// no separate password to leak, and an id can only reach these by having signed
// in through Telegram OIDC AND being listed in BOT_ADMIN_IDS.
function requireAdminAuth(req: any, res: any, next: any) {
  const telegramId = getAuthenticatedTelegramId(req);

  if (telegramId === null) {
    res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    return;
  }

  if (!DASHBOARD_ADMIN_IDS.has(String(telegramId))) {
    // 404 rather than 403: an admin surface should not confirm its own
    // existence to someone who is not one.
    res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return;
  }

  req.telegramId = telegramId;
  next();
}

// Fix: wallet-only login (no Telegram account required). Everything in
// this system is keyed off a numeric "account id" (called chatId, since it
// originally only ever came from Telegram). For a wallet-only account we
// derive a STABLE, deterministic id from the wallet name — always negative,
// so it can never collide with a real Telegram user id (those are always
// positive). Same wallet name always maps to the same id, no separate
// lookup table needed.
function walletNameToVirtualAccountId(walletName: string): number {
  const normalized = walletName.trim().toLowerCase();
  let hash = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) % 2147483647;
  }

  return -1 * (hash || 1);
}

// --- Telegram OpenID Connect login ---------------------------------------
//
// Telegram moved bot login to standard OIDC (Authorization Code + PKCE), and
// switching a bot over in BotFather is one-way: once switched, the legacy
// iframe widget's /auth endpoint answers "deprecated" for that bot. This bot
// has already been switched, so the widget flow above (verifyTelegramLoginPayload)
// is dead for it and this is the only working Telegram login path.
//
// Endpoints come from https://oauth.telegram.org/.well-known/openid-configuration
const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_OIDC_AUTH_URL = `${TELEGRAM_OIDC_ISSUER}/auth`;
const TELEGRAM_OIDC_TOKEN_URL = `${TELEGRAM_OIDC_ISSUER}/token`;
const TELEGRAM_OIDC_JWKS_URL = `${TELEGRAM_OIDC_ISSUER}/.well-known/jwks.json`;

const TELEGRAM_CLIENT_ID = process.env.TELEGRAM_CLIENT_ID || "";
const TELEGRAM_CLIENT_SECRET = process.env.TELEGRAM_CLIENT_SECRET || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://ackinackiradar.com").replace(/\/+$/, "");
const TELEGRAM_OIDC_REDIRECT_URI = `${PUBLIC_BASE_URL}/api/auth/telegram/callback`;
const DASHBOARD_PATH = "/cloud-miner";

// Lazily built so a missing/unreachable JWKS can't break server startup.
let telegramJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getTelegramJwks() {
  if (!telegramJwks) {
    telegramJwks = createRemoteJWKSet(new URL(TELEGRAM_OIDC_JWKS_URL));
  }
  return telegramJwks;
}

// Pending logins live in memory only. A restart drops them, which just means
// an in-flight login has to be restarted — no persistence worth the risk of
// writing PKCE verifiers to disk.
type PendingOidcLogin = { codeVerifier: string; createdAt: number };
const pendingOidcLogins = new Map<string, PendingOidcLogin>();
const OIDC_LOGIN_TTL_MS = 10 * 60 * 1000;

function prunePendingOidcLogins() {
  const cutoff = Date.now() - OIDC_LOGIN_TTL_MS;
  for (const [state, entry] of pendingOidcLogins) {
    if (entry.createdAt < cutoff) pendingOidcLogins.delete(state);
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function makePkcePair() {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(
    crypto.createHash("sha256").update(codeVerifier).digest(),
  );
  return { codeVerifier, codeChallenge };
}

// The ID token carries both `sub` and `id`. `sub` is the OIDC subject, which
// providers are free to make client-specific; `id` is documented as the
// Telegram user id. Everything else in this project (bot chatIds, bee-miners
// records, payment subscriptions) is keyed by Telegram user id, so we must
// use `id` when it's present or the dashboard would create a parallel set of
// user records that the bot can't see.
function telegramIdFromClaims(claims: Record<string, any>): number | null {
  const candidate = claims.id != null ? claims.id : claims.sub;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

export function startServer(port: number) {
  const app = express();

  app.disable("x-powered-by");

  // Nginx is the only trusted reverse proxy. This makes req.ip reflect the
  // real client address for rate limiting without trusting arbitrary peers.
  app.set("trust proxy", "loopback");

  app.use(
    cors({
      origin: DASHBOARD_ALLOWED_ORIGINS,
      methods: ["GET", "HEAD", "POST", "OPTIONS"],
    }),
  );
  app.use(express.json());
  app.use(
    "/api",
    createRateLimiter({
      maxRequests: 300,
      windowMs: 60 * 1000,
      scope: "api",
    }),
  );
  app.use(
    "/api/auth",
    createRateLimiter({
      maxRequests: 30,
      windowMs: 60 * 1000,
      scope: "auth",
    }),
  );
  app.use(
    "/api/admin",
    createRateLimiter({
      maxRequests: 120,
      windowMs: 60 * 1000,
      scope: "admin",
    }),
  );
  app.use(express.static(path.join(process.cwd(), "public")));

  // --- Dashboard auth ---
  app.post("/api/auth/telegram", (req, res) => {
    const data = req.body || {};

    if (!verifyTelegramLoginPayload(data)) {
      res.status(401).json({ ok: false, error: "INVALID_TELEGRAM_LOGIN" });
      return;
    }

    const telegramId = Number(data.id);
    const token = signSession(telegramId);

    res.json({
      ok: true,
      token,
      user: {
        telegramId,
        firstName: data.first_name || "",
        username: data.username || null,
        photoUrl: data.photo_url || null,
      },
    });
  });

  // --- Telegram OIDC: step 1, send the browser to Telegram ---
  app.get("/api/auth/telegram/start", (_req, res) => {
    // This endpoint is reached by a browser navigation, not fetch(), so every
    // failure has to come back as a redirect — a JSON body would just render
    // as raw text in the address bar.
    if (!TELEGRAM_CLIENT_ID || !TELEGRAM_CLIENT_SECRET) {
      res.redirect(`${DASHBOARD_PATH}#tg_error=TELEGRAM_OIDC_NOT_CONFIGURED`);
      return;
    }

    prunePendingOidcLogins();

    const state = base64UrlEncode(crypto.randomBytes(24));
    const { codeVerifier, codeChallenge } = makePkcePair();
    pendingOidcLogins.set(state, { codeVerifier, createdAt: Date.now() });

    const url = new URL(TELEGRAM_OIDC_AUTH_URL);
    url.searchParams.set("client_id", TELEGRAM_CLIENT_ID);
    url.searchParams.set("redirect_uri", TELEGRAM_OIDC_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    res.redirect(url.toString());
  });

  // --- Telegram OIDC: step 2, Telegram sends the browser back here ---
  app.get("/api/auth/telegram/callback", async (req, res) => {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");

    const fail = (reason: string) => {
      // Bounce back to the dashboard with an error in the fragment so the page
      // can show it; never render the raw provider response.
      res.redirect(`${DASHBOARD_PATH}#tg_error=${encodeURIComponent(reason)}`);
    };

    if (req.query.error) {
      fail(String(req.query.error));
      return;
    }
    if (!code || !state) {
      fail("MISSING_CODE_OR_STATE");
      return;
    }

    prunePendingOidcLogins();
    const pending = pendingOidcLogins.get(state);

    // Single-use: consume the state whether or not the rest succeeds, so a
    // replayed callback can't be exchanged twice.
    pendingOidcLogins.delete(state);

    if (!pending) {
      fail("STATE_EXPIRED");
      return;
    }

    try {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: TELEGRAM_OIDC_REDIRECT_URI,
        client_id: TELEGRAM_CLIENT_ID,
        code_verifier: pending.codeVerifier,
      });

      const basic = Buffer.from(
        `${TELEGRAM_CLIENT_ID}:${TELEGRAM_CLIENT_SECRET}`,
      ).toString("base64");

      const tokenRes = await fetch(TELEGRAM_OIDC_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        body,
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error("Telegram OIDC token exchange failed:", {
          status: tokenRes.status,
          body: text.slice(0, 400),
        });
        fail("TOKEN_EXCHANGE_FAILED");
        return;
      }

      const tokens: any = await tokenRes.json();

      if (!tokens?.id_token) {
        fail("NO_ID_TOKEN");
        return;
      }

      const { payload } = await jwtVerify(tokens.id_token, getTelegramJwks(), {
        issuer: TELEGRAM_OIDC_ISSUER,
        audience: TELEGRAM_CLIENT_ID,
      });

      const telegramId = telegramIdFromClaims(payload as Record<string, any>);

      if (!telegramId) {
        console.error("Telegram OIDC: no usable user id in claims", {
          claimKeys: Object.keys(payload),
        });
        fail("NO_USER_ID");
        return;
      }

      // One-time diagnostic: confirms whether `sub` and `id` agree. If they
      // ever diverge, `id` is the one that matches the bot's chatIds.
      console.log("Telegram OIDC login ok:", {
        telegramId,
        subClaim: (payload as any).sub,
        idClaim: (payload as any).id,
        subMatchesId: String((payload as any).sub) === String((payload as any).id),
        username: (payload as any).preferred_username || null,
      });

      const token = signSession(telegramId);
      const username = String((payload as any).preferred_username || "");

      res.redirect(
        `${DASHBOARD_PATH}#tg_token=${encodeURIComponent(token)}` +
          (username ? `&tg_user=${encodeURIComponent(username)}` : ""),
      );
    } catch (error) {
      console.error("Telegram OIDC callback failed:", {
        message: error instanceof Error ? error.message : String(error),
      });
      fail("CALLBACK_FAILED");
    }
  });

  // --- Wallet-only login (no Telegram account needed) ---
  // Step 1: prove ownership of the wallet the same way /miner_connect does
  // (generate an app-specific mining key, user approves it in AN Wallet).
  // Wallet-name sign-in was removed from the UI on 2026-08-10; this refuses it
  // at the API too, so it cannot be reached by hand. It filed the account under
  // a NEGATIVE virtual chatId — such a user can never be matched to a
  // subscription and can never mine — and it quietly created a second miner
  // record for a wallet the person had already connected.
  //
  // Registered BEFORE the original handlers on purpose: Express takes the first
  // matching route, so the old ones simply never run. Putting an early return
  // inside them instead would leave their bodies unreachable, which breaks
  // TypeScript's narrowing and produces a wall of false errors.
  app.post(
    ["/api/auth/wallet/start", "/api/auth/wallet/confirm"],
    (_req, res) => {
      res.status(410).json({ ok: false, error: "WALLET_LOGIN_REMOVED" });
    },
  );

  app.post("/api/auth/wallet/start", async (req, res) => {
    const walletName = String(req.body?.walletName || "").trim();

    if (!walletName) {
      res.status(400).json({ ok: false, error: "WALLET_NAME_REQUIRED" });
      return;
    }

    if (!BEE_APP_ID) {
      res.status(503).json({ ok: false, error: "BEE_APP_ID_NOT_CONFIGURED" });
      return;
    }

    try {
      const accountId = walletNameToVirtualAccountId(walletName);
      const keys = await beeGenerateMiningKeys(BEE_APP_ID);
      const minerAddress = await beeResolveMinerAddress({ appId: BEE_APP_ID, walletName });

      const state = readBeeMinerState();
      const id = `${accountId}:${walletName}`;
      const existingIndex = state.miners.findIndex((m) => m.id === id);

      const record: BeeMinerRecord = {
        id,
        chatId: accountId,
        walletName,
        appId: BEE_APP_ID,
        publicKey: keys.publicKey,
        secretKey: keys.secretKey,
        minerAddress,
        status: "pending_authorization",
        lastError: null,
        lastSessionAt: null,
        lastTapsSent: null,
        lastRewardAt: null,
        createdAt: new Date().toISOString(),
        // Stored so a repeated "Connect" can hand back the SAME link instead of
        // minting a keypair that invalidates the approval already in flight.
        deepLink: keys.deepLink,
      } as BeeMinerRecord;

      if (existingIndex >= 0) {
        state.miners[existingIndex] = record;
      } else {
        state.miners.push(record);
      }

      writeBeeMinerState(state);

      res.json({ ok: true, deepLink: keys.deepLink, walletName });
    } catch (error) {
      console.error("Wallet-only login start failed:", {
        walletName,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({ ok: false, error: "START_FAILED" });
    }
  });

  // Step 2: after the user approves in AN Wallet, confirm + issue a session
  // — this both activates cloud mining for the wallet AND logs the user in,
  // in one step. No Telegram involved anywhere in this flow.
  app.post("/api/auth/wallet/confirm", async (req, res) => {
    const walletName = String(req.body?.walletName || "").trim();

    if (!walletName) {
      res.status(400).json({ ok: false, error: "WALLET_NAME_REQUIRED" });
      return;
    }

    const accountId = walletNameToVirtualAccountId(walletName);
    const state = readBeeMinerState();
    const record = state.miners.find(
      (m) => m.chatId === accountId && m.walletName === walletName,
    );

    if (!record) {
      res.status(404).json({ ok: false, error: "NO_PENDING_CONNECTION" });
      return;
    }

    try {
      if (!record.minerAddress) throw new Error("MINER_ADDRESS_MISSING");

      await beeWaitForMiningKeyPropagation({
        appId: record.appId,
        minerAddress: record.minerAddress,
        expectedOwnerPublic: record.publicKey,
        // 36s, matching the bot. It was 3s here, which is far less time than
        // the chain needs to publish the key after the user approves — the
        // dashboard gave up almost immediately and the connection appeared to
        // hang forever. The bot hit exactly this and was fixed long ago; these
        // two call sites were missed.
        maxAttempts: 30,
        intervalMs: 1200,
      });

      // Key propagation is the connection proof. Mining itself belongs only
      // to the isolated Bee worker; the web process must not create a second
      // Miner/event reader for this wallet.
      record.status = "active";
      record.lastError = null;
      writeBeeMinerState(state);

      const token = signSession(accountId);

      res.json({
        ok: true,
        token,
        user: { telegramId: accountId, firstName: walletName, username: null, photoUrl: null },
      });
    } catch (error) {
      res.status(409).json({
        ok: false,
        error: "NOT_YET_APPROVED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });


  // ============================================================
  // MINER_CYCLE_CHAIN_CLOCK_20260814
  //
  // Official Miner.sol:
  //   currentBigEpochStart =
  //     block.seqno - (block.seqno % MinerTapDelay)
  //
  // MinerTapDelay = 262000 blocks.
  //
  // Block boundaries are exact.
  // Wall-clock UTC times are estimates from the LIVE measured
  // chain block rate and are refreshed continuously.
  // ============================================================

  const MINER_CYCLE_BLOCK_PERIOD =
    262_000;

  // Normal operation consumes the central radar snapshot below. This fallback
  // is only for a first boot where no in-memory or durable snapshot exists yet.
  const MINER_CYCLE_GRAPHQL_URL =
    process.env.ACKI_MAINNET_GRAPHQL_URL ||
    "https://mainnet.ackinacki.org/graphql";
  const MINER_CYCLE_CACHE_MS = 60_000;

  // Bootstrap comes from the live chain measurement made on
  // 2026-08-14:
  // 188 blocks / 65 sec = 2.892308 blocks/sec.
  //
  // It is only used until this server has collected two fresh
  // chain samples. Then the live measured rate replaces it.
  let minerCycleRateBps =
    2.892308;

  let minerCycleRateSource:
    "bootstrap" | "live" =
    "bootstrap";

  type MinerCycleSample = {
    seqNo: number;
    chainTimestamp: number;
    fetchedAtMs: number;
  };

  let minerCycleLastSample: MinerCycleSample | null = null;
  let minerCycleFetchInFlight: Promise<any> | null = null;
  let minerCycleFallbackNextAttemptAtMs = 0;


  function buildMinerCycleClock(
    sample: MinerCycleSample,
    stale: boolean,
  ) {

    const nowMs =
      Date.now();

    const ageSeconds =
      Math.max(
        0,
        (
          nowMs -
          sample.fetchedAtMs
        ) / 1000,
      );

    const projectedSeq =
      sample.seqNo +
      ageSeconds *
        minerCycleRateBps;

    const currentSeqNo =
      Math.floor(
        projectedSeq,
      );

    const epochStartSeq =
      Math.floor(
        currentSeqNo /
          MINER_CYCLE_BLOCK_PERIOD,
      ) *
      MINER_CYCLE_BLOCK_PERIOD;

    const epochEndSeq =
      epochStartSeq +
      MINER_CYCLE_BLOCK_PERIOD;

    const elapsedBlocks =
      Math.max(
        0,
        currentSeqNo -
          epochStartSeq,
      );

    const remainingBlocks =
      Math.max(
        0,
        epochEndSeq -
          currentSeqNo,
      );

    const elapsedSeconds =
      elapsedBlocks /
      minerCycleRateBps;

    const remainingSeconds =
      remainingBlocks /
      minerCycleRateBps;

    const fullCycleSeconds =
      MINER_CYCLE_BLOCK_PERIOD /
      minerCycleRateBps;

    const projectedChainTimestamp =
      sample.chainTimestamp +
      ageSeconds;

    const epochStartTimestamp =
      projectedChainTimestamp -
      elapsedSeconds;

    const epochEndTimestamp =
      projectedChainTimestamp +
      remainingSeconds;

    const progress =
      Math.min(
        100,
        Math.max(
          0,
          (
            elapsedBlocks /
            MINER_CYCLE_BLOCK_PERIOD
          ) *
          100,
        ),
      );

    return {
      periodBlocks:
        MINER_CYCLE_BLOCK_PERIOD,

      observedSeqNo:
        sample.seqNo,

      currentSeqNo,

      epochStartSeq,

      epochEndSeq,

      elapsedBlocks,

      remainingBlocks,

      blocksPerSecond:
        minerCycleRateBps,

      rateSource:
        minerCycleRateSource,

      remainingSeconds,

      fullCycleSeconds,

      progress,

      epochStartAt:
        new Date(
          epochStartTimestamp *
            1000,
        ).toISOString(),

      epochEndAt:
        new Date(
          epochEndTimestamp *
            1000,
        ).toISOString(),

      chainTimestamp:
        sample.chainTimestamp,

      observedAt:
        new Date(
          nowMs,
        ).toISOString(),

      sampleAgeSeconds:
        ageSeconds,

      stale,
    };
  }


  async function readMinerCycleClock() {

    const now =
      Date.now();

    // Reuse the central blocks(last:300) result. The old implementation made
    // a second blocks(last:1) request as often as every 15 seconds, competing
    // with the radar sampler and Bee for the same exhausted block-index pool.
    const sharedSnapshot = lastGoodChainStats;
    const sharedSeqNo = Number(sharedSnapshot?.data?.latestBlock);
    const sharedChainTimestamp = Number(sharedSnapshot?.data?.latestBlockTime);

    if (
      sharedSnapshot &&
      Number.isFinite(sharedSeqNo) &&
      sharedSeqNo > 0 &&
      Number.isFinite(sharedChainTimestamp) &&
      sharedChainTimestamp > 0
    ) {
      const fresh: MinerCycleSample = {
        seqNo: Math.floor(sharedSeqNo),
        chainTimestamp: Math.floor(sharedChainTimestamp),
        fetchedAtMs: sharedSnapshot.atMs,
      };

      if (!minerCycleLastSample || fresh.seqNo > minerCycleLastSample.seqNo) {
        const sharedRate = Number(sharedSnapshot.data?.blocksPerSecond);

        if (sharedRate >= 1 && sharedRate <= 5) {
          minerCycleRateBps =
            minerCycleRateSource === "bootstrap"
              ? sharedRate
              : minerCycleRateBps * 0.65 + sharedRate * 0.35;
          minerCycleRateSource = "live";
        }

        minerCycleLastSample = fresh;
      }

      return buildMinerCycleClock(
        minerCycleLastSample || fresh,
        now - sharedSnapshot.atMs > CHAIN_STATS_WARN_STALE_MS,
      );
    }

    if (
      minerCycleLastSample &&
      now -
        minerCycleLastSample.fetchedAtMs <
        MINER_CYCLE_CACHE_MS
    ) {
      return buildMinerCycleClock(
        minerCycleLastSample,
        false,
      );
    }

    if (minerCycleFetchInFlight) {
      return minerCycleFetchInFlight;
    }

    if (now < minerCycleFallbackNextAttemptAtMs) {
      throw new Error("CHAIN_CLOCK_FALLBACK_BACKOFF");
    }

    minerCycleFallbackNextAttemptAtMs = now + MINER_CYCLE_CACHE_MS;

    minerCycleFetchInFlight =
      (async () => {

        try {

          const response =
            await fetch(
              MINER_CYCLE_GRAPHQL_URL,
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify({
                    query:
                      "query{blockchain{blocks(last:1){edges{node{seq_no gen_utime}}}}}",
                  }),

                signal:
                  AbortSignal.timeout(
                    12_000,
                  ),
              },
            );

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}`,
            );
          }

          const payload:
            any =
            await response.json();

          const node =
            payload?.data
              ?.blockchain
              ?.blocks
              ?.edges?.[0]
              ?.node;

          const seqNo =
            Number(
              node?.seq_no,
            );

          const chainTimestamp =
            Number(
              node?.gen_utime,
            );

          if (
            !Number.isFinite(seqNo) ||
            !Number.isFinite(
              chainTimestamp,
            )
          ) {
            throw new Error(
              "INVALID_CHAIN_BLOCK_RESPONSE",
            );
          }

          const fresh = {
            seqNo:
              Math.floor(seqNo),

            chainTimestamp:
              Math.floor(
                chainTimestamp,
              ),

            fetchedAtMs:
              Date.now(),
          };

          const previous =
            minerCycleLastSample;

          if (previous) {

            const deltaBlocks =
              fresh.seqNo -
              previous.seqNo;

            const deltaSeconds =
              fresh.chainTimestamp -
              previous.chainTimestamp;

            if (
              deltaBlocks > 0 &&
              deltaSeconds >= 10
            ) {

              const observedRate =
                deltaBlocks /
                deltaSeconds;

              // Reject impossible/noisy samples.
              if (
                observedRate >= 1 &&
                observedRate <= 5
              ) {

                if (
                  minerCycleRateSource ===
                  "bootstrap"
                ) {
                  minerCycleRateBps =
                    observedRate;
                } else {
                  // Smooth short-term block-time noise while
                  // still following actual network speed.
                  minerCycleRateBps =
                    (
                      minerCycleRateBps *
                      0.65
                    ) +
                    (
                      observedRate *
                      0.35
                    );
                }

                minerCycleRateSource =
                  "live";
              }
            }
          }

          minerCycleLastSample =
            fresh;

          return buildMinerCycleClock(
            fresh,
            false,
          );

        } catch (error) {

          // GraphQL has recently produced pool timeouts.
          // Keep an existing chain sample alive instead of
          // blanking the dashboard.
          if (
            minerCycleLastSample
          ) {
            return {
              ...buildMinerCycleClock(
                minerCycleLastSample,
                true,
              ),

              warning:
                error instanceof Error
                  ? error.message
                  : String(error),
            };
          }

          throw error;

        } finally {
          minerCycleFetchInFlight =
            null;
        }
      })();

    return minerCycleFetchInFlight;
  }


  app.get(
    "/api/dashboard/mining-cycle-clock",
    requireDashboardAuth,
    async (_req: any, res) => {

      try {

        const clock =
          await readMinerCycleClock();

        res.json({
          ok: true,
          clock,
        });

      } catch (error) {

        console.warn(
          "Mining cycle clock read failed:",
          {
            message:
              error instanceof Error
                ? error.message
                : String(error),
          },
        );

        res.status(503).json({
          ok: false,
          error:
            "CHAIN_CLOCK_UNAVAILABLE",
        });
      }
    },
  );


  // --- Dashboard: overview (miners + subscription + plans) ---
  app.get("/api/dashboard/me", requireDashboardAuth, (req: any, res) => {
    const chatId = req.telegramId;
    const minerState = readBeeMinerState();
    const paymentsState = readPaymentsState();

    const miners = minerState.miners
      .filter((miner) => miner.chatId === chatId)
      .map((miner) => ({
        walletName: miner.walletName,
        status: miner.status,
        lastSessionAt: miner.lastSessionAt,
        lastSessionStartedAt: miner.lastSessionStartedAt ?? null,
        lastTapsSent: miner.lastTapsSent,
        lastRewardAt: miner.lastRewardAt,
        lastError: miner.lastError,
        tapSum: miner.lastTapSum ?? null,
        tapSumAt: miner.lastTapSumAt ?? null,
        epoch5mStart: miner.lastEpoch5mStart ?? null,
        epoch5mChangedAt: miner.lastEpoch5mChangedAt ?? null,
        sessionEpoch5mStart: miner.lastSessionEpoch5mStart ?? null,
        sessionEpochStatus: miner.lastSessionEpochStatus ?? null,
        claimedEpoch5mStart: miner.lastClaimedEpoch5mStart ?? null,
        cycleEpochCount:
          rewardCycleState.get(miner.walletName)?.count ?? 0,
        rewardLastChainReadAt: rewardLastChainReadAt.get(miner.walletName) ?? null,
      }));

    const ownedMinerIds = new Set(
      minerState.miners
        .filter((miner) => miner.chatId === chatId)
        .map((miner) => miner.id),
    );

    const miningHealth =
      readBeeMiningHealth(
        ownedMinerIds
      );

    // Table:
    // newest rows from the complete current-cycle feeds.
    const dashboardRewards =
      miners
        .flatMap(
          (m) =>
            (
              rewardFeed.get(
                m.walletName
              ) ??
              []
            ).map(
              (tick) => ({
                ...tick,
                walletName:
                  m.walletName,
              }),
            ),
        )
        .sort(
          (a, b) =>
            Date.parse(
              String(
                b.at ||
                ""
              )
            ) -
            Date.parse(
              String(
                a.at ||
                ""
              )
            ),
        )
        .slice(
          0,
          REWARD_FEED_MAX,
        );

    // Total:
    // complete cumulative delta since
    // current mining-cycle baseline.
    let rewardCycleTotalNackl =
      0;

    let rewardCycleCount =
      0;

    let rewardCyclePartial =
      false;

    for (
      const miner
      of miners
    ) {
      const cycle =
        rewardCycleState.get(
          miner.walletName
        );

      const chainTotal =
        rewardLastTotal.get(
          miner.walletName
        );

      if (
        !cycle ||
        chainTotal == null
      ) {
        continue;
      }

      rewardCycleTotalNackl +=
        Math.max(
          0,
          chainTotal -
            cycle.baselineTotal,
        );

      rewardCycleCount +=
        cycle.count;

      rewardCyclePartial ||=
        cycle.partial;
    }

    const rewardCycle = {
      totalNackl:
        rewardCycleTotalNackl,

      count:
        rewardCycleCount,

      partial:
        rewardCyclePartial,
    };

    const subscription =
      paymentsState
        .subscriptions[
          String(chatId)
        ] ||
      null;

    const referralState =
      buildReferralDashboardState(
        paymentsState,
        chatId,
      );

    if (referralState.changed) {
      writePaymentsState(
        paymentsState,
      );
    }

    res.json({
      ok: true,
      miners,
      miningHealth,
      subscription,
      referral: referralState.data,
      plans: PLANS.map((plan) => ({
        id: plan.id,
        label: plan.label,
        days: plan.days,
        priceUsd: plan.priceUsd,
        priceShellRaw: plan.priceShellRaw,
        priceNackl: formatNacklAmount(plan.priceNacklRaw),
        stars: getPlanStars(plan),
        starsPriceUsd: getPlanStarsPriceUsd(plan),
      })),
      paymentsWallet: PAYMENTS_WALLET_NAME,
      // Drives the dashboard's Buy buttons. Follows the TON rail now, since
      // that is what this page actually sells through.
      paymentsLive: TON_PAYMENTS_CHECK_ENABLED,
      starsPaymentsLive: Boolean(BOT_TOKEN),
      nacklPaymentsLive:
        NACKL_PAYMENTS_CHECK_ENABLED && paymentsState.nacklBaselineReady === true,
      nacklPaymentsWallet: NACKL_PAYMENTS_WALLET_NAME,
      epochClock: getChainEpochClock(),
      cycle: {
        tapCap: BEE_CYCLE_TAP_CAP,
        hours: BEE_CYCLE_HOURS,
        tapsPerSession: BEE_MINING_TAP_COUNT,
        sessionIntervalSeconds: BEE_MINING_INTERVAL_SECONDS,
      },
      // Visible table = latest 100.
      // rewardCycle = uncapped current cycle.
      rewards:
        dashboardRewards,

      rewardCycle,

      rewardFeedPollSeconds:
        Math.round(
          REWARD_FEED_POLL_MS /
          1000
        ),
    });
  });


  // --- Dashboard: bind a referral code permanently to this account ---
  /*
   * PHASE_7I_REWARD_CLEAR_ENDPOINT
   *
   * Clears only the visible reward-feed rows owned
   * by the authenticated dashboard user.
   *
   * Current-cycle cumulative total/count remain
   * untouched and continue until the real cycle
   * boundary resets them.
   */
  app.post(
    "/api/dashboard/rewards/clear",
    requireDashboardAuth,
    (req: any, res) => {

      const chatId =
        req.telegramId;

      const state =
        readBeeMinerState();

      const walletNames =
        Array.from(
          new Set(
            state.miners
              .filter(
                miner =>
                  miner.chatId ===
                  chatId
              )
              .map(
                miner =>
                  miner.walletName
              )
          )
        );


      for (
        const walletName
        of walletNames
      ) {
        rewardFeed.set(
          walletName,
          []
        );
      }


      writeRewardFeedState();


      console.log(
        "Dashboard reward feed cleared:",
        {
          chatId,
          wallets:
            walletNames.length,
        }
      );


      res.json({
        ok: true,
        clearedWallets:
          walletNames.length,
      });
    }
  );


  app.post(
    "/api/dashboard/referral/bind",
    requireDashboardAuth,
    (req: any, res) => {
      const referredChatId =
        Number(
          req.telegramId,
        );

      const code =
        String(
          req.body?.code || "",
        ).trim();

      if (
        !Number.isSafeInteger(
          referredChatId,
        ) ||
        referredChatId <= 0 ||
        !/^[A-Za-z0-9_-]{8,64}$/.test(
          code,
        )
      ) {
        res.status(
          400,
        ).json({
          ok: false,
          error:
            "INVALID_REFERRAL_CODE",
        });

        return;
      }

      const state =
        readPaymentsState();

      const referrerChatId =
        findReferralOwnerByCode(
          state,
          code,
        );

      if (
        !referrerChatId
      ) {
        res.status(
          404,
        ).json({
          ok: false,
          error:
            "REFERRAL_CODE_NOT_FOUND",
        });

        return;
      }

      if (
        referrerChatId ===
        referredChatId
      ) {
        res.status(
          400,
        ).json({
          ok: false,
          error:
            "SELF_REFERRAL_NOT_ALLOWED",
        });

        return;
      }

      if (
        !state.referrals ||
        typeof state.referrals !==
          "object"
      ) {
        state.referrals = {};
      }

      const key =
        String(
          referredChatId,
        );

      const existingBinding =
        state.referrals[key];

      if (
        existingBinding
      ) {
        if (
          existingBinding
            .referrerChatId ===
          referrerChatId
        ) {
          res.json({
            ok: true,
            bound: true,
            alreadyBound: true,
          });

          return;
        }

        res.status(
          409,
        ).json({
          ok: false,
          error:
            "REFERRAL_ALREADY_BOUND",
        });

        return;
      }

      const existingSubscription =
        state.subscriptions[key];

      // Trial users may still bind.
      // Non-trial subscriptions cannot
      // receive a referrer retroactively.
      if (
        existingSubscription &&
        existingSubscription.trial !==
          true
      ) {
        res.status(
          409,
        ).json({
          ok: false,
          error:
            "REFERRAL_BIND_TOO_LATE",
        });

        return;
      }

      state.referrals[key] = {
        referredChatId,
        referrerChatId,
        code,

        boundAt:
          new Date()
            .toISOString(),

        qualifiedAt: null,
        qualifiedPlanId: null,
        paymentSource: null,
      };

      writePaymentsState(
        state,
      );

      console.log(
        "Referral bound:",
        {
          referredChatId,
          referrerChatId,
        },
      );

      res.json({
        ok: true,
        bound: true,
        alreadyBound: false,
      });
    },
  );

  // Mining access is checked at every dashboard entry point as well as
  // inside the Bee scheduler. The scheduler remains the final authority, but
  // refusing here prevents an unsubscribed wallet from looking active in UI.
  function hasDashboardMiningAccess(chatId: number): boolean {
    if (DASHBOARD_ADMIN_IDS.has(String(chatId))) {
      return true;
    }

    const subscription =
      readPaymentsState().subscriptions[String(chatId)];

    const activeUntil = subscription
      ? new Date(subscription.activeUntil).getTime()
      : NaN;

    return Number.isFinite(activeUntil) && activeUntil > Date.now();
  }

  // --- Dashboard: pause / resume cloud mining ---
  // The tick only picks up miners whose status is "active", so pausing is just
  // a status flip. Deliberately refuses to touch a miner that is in
  // "pending_authorization" or "error": those need the connect/check flow, and
  // silently marking them active would put a broken miner back into rotation.
  function setMinerRunning(req: any, res: any, shouldRun: boolean) {
    const chatId = req.telegramId;
    const walletName = String(req.body?.walletName || "").trim();

    if (shouldRun && !hasDashboardMiningAccess(chatId)) {
      res.status(403).json({
        ok: false,
        error: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }

    const state = readBeeMinerState();

    const record = state.miners.find(
      (miner) =>
        miner.chatId === chatId &&
        (!walletName || miner.walletName === walletName),
    );

    if (!record) {
      res.status(404).json({ ok: false, error: "MINER_NOT_FOUND" });
      return;
    }

    const allowed = shouldRun ? ["stopped"] : ["active"];

    if (!allowed.includes(record.status)) {
      res.status(409).json({
        ok: false,
        error: "INVALID_STATE",
        status: record.status,
      });
      return;
    }

    // One wallet per plan. The scheduler enforces this too, but refusing here
    // means the dashboard can say why instead of showing a wallet that looks
    // started and never mines.
    if (
      shouldRun &&
      !DASHBOARD_ADMIN_IDS.has(String(chatId)) &&
      state.miners.some(
        (miner) => miner.chatId === chatId && miner.status === "active",
      )
    ) {
      res.status(409).json({ ok: false, error: "ONE_WALLET_PER_PLAN" });
      return;
    }

    record.status = shouldRun ? "active" : "stopped";
    record.lastError = null;
    writeBeeMinerState(state);
    if (!shouldRun && record.minerAddress) {
      beeDiscardMiner({
        appId: record.appId,
        minerAddress: record.minerAddress,
        publicKey: record.publicKey,
      });
    }

    console.log("Dashboard miner state changed:", {
      walletName: record.walletName,
      chatId,
      status: record.status,
    });

    res.json({ ok: true, walletName: record.walletName, status: record.status });
  }

  app.post("/api/dashboard/miner/start", requireDashboardAuth, (req: any, res) => {
    setMinerRunning(req, res, true);
  });

  app.post("/api/dashboard/miner/stop", requireDashboardAuth, (req: any, res) => {
    setMinerRunning(req, res, false);
  });

  // Removal, as opposed to /stop which only flips the status. Until now there
  // was no way at all — on the dashboard or in the bot — to get a wallet out of
  // our storage, and that record holds the user's mining secret key in plain
  // text. Someone asking to disconnect has to be able to actually leave.
  app.post("/api/dashboard/miner/remove", requireDashboardAuth, (req: any, res) => {
    const chatId = req.telegramId;
    const walletName = String(req.body?.walletName || "").trim();

    if (!walletName) {
      res.status(400).json({ ok: false, error: "WALLET_NAME_REQUIRED" });
      return;
    }

    const state = readBeeMinerState();
    const record = state.miners.find(
      (miner) => miner.chatId === chatId && miner.walletName === walletName,
    );

    if (!record) {
      res.status(404).json({ ok: false, error: "MINER_NOT_FOUND" });
      return;
    }

    // Drop the pooled wasm instance BEFORE the record goes, while its keys are
    // still readable — otherwise a live session keeps running against a miner
    // nobody owns any more.
    if (record.minerAddress) {
      beeDiscardMiner({
        appId: record.appId,
        minerAddress: record.minerAddress,
        publicKey: record.publicKey,
      });
    }

    state.miners = state.miners.filter((miner) => miner.id !== record.id);
    writeBeeMinerState(state);

    console.log("Dashboard miner removed:", {
      walletName: record.walletName,
      chatId,
      previousStatus: record.status,
    });

    res.json({ ok: true, walletName: record.walletName, removed: true });
  });

  // --- Dashboard: connect a wallet for cloud mining ---
  app.post("/api/dashboard/miner/connect", requireDashboardAuth, async (req: any, res) => {
    const chatId = req.telegramId;
    const walletName = String(req.body?.walletName || "").trim();

    if (!walletName) {
      res.status(400).json({ ok: false, error: "WALLET_NAME_REQUIRED" });
      return;
    }

    if (!BEE_APP_ID) {
      res.status(503).json({ ok: false, error: "BEE_APP_ID_NOT_CONFIGURED" });
      return;
    }

    if (!hasDashboardMiningAccess(chatId)) {
      res.status(403).json({
        ok: false,
        error: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }

    try {
      const state = readBeeMinerState();
      const id = `${chatId}:${walletName}`;
      const existingIndex = state.miners.findIndex((m) => m.id === id);
      const existing = existingIndex >= 0 ? state.miners[existingIndex] : undefined;

      // Reuse the pending connection instead of minting a new keypair.
      //
      // This regenerated keys on EVERY press, which quietly broke the retry
      // everyone reaches for: approve the QR, nothing seems to happen, press
      // "Connect" again — and that second press invalidates the approval that
      // was already on its way, because the chain now holds a key we just threw
      // away. The result is a wallet that can never finish connecting.
      if (
        existing &&
        existing.status === "pending_authorization" &&
        (existing as any).deepLink
      ) {
        res.json({ ok: true, deepLink: (existing as any).deepLink, reused: true });
        return;
      }

      const keys = await beeGenerateMiningKeys(BEE_APP_ID);
      const minerAddress = await beeResolveMinerAddress({ appId: BEE_APP_ID, walletName });

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
        lastSessionAt: null,
        lastTapsSent: null,
        lastRewardAt: null,
        createdAt: new Date().toISOString(),
        // Stored so a repeated "Connect" can hand back the SAME link instead of
        // minting a keypair that invalidates the approval already in flight.
        deepLink: keys.deepLink,
      } as BeeMinerRecord;

      if (existingIndex >= 0) {
        state.miners[existingIndex] = record;
      } else {
        state.miners.push(record);
      }

      writeBeeMinerState(state);

      res.json({ ok: true, deepLink: keys.deepLink, walletName });
    } catch (error) {
      console.error("Dashboard miner connect failed:", {
        walletName,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({ ok: false, error: "CONNECT_FAILED" });
    }
  });

  // --- Dashboard: confirm a pending wallet connection ---
  app.post("/api/dashboard/miner/check", requireDashboardAuth, async (req: any, res) => {
    const chatId = req.telegramId;
    const walletName = String(req.body?.walletName || "").trim();

    if (!hasDashboardMiningAccess(chatId)) {
      res.status(403).json({
        ok: false,
        error: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }

    const state = readBeeMinerState();
    const record = state.miners.find(
      (m) => m.chatId === chatId && m.walletName === walletName && m.status === "pending_authorization",
    );

    if (!record) {
      res.status(404).json({ ok: false, error: "NO_PENDING_CONNECTION" });
      return;
    }

    try {
      if (!record.minerAddress) throw new Error("MINER_ADDRESS_MISSING");

      await beeWaitForMiningKeyPropagation({
        appId: record.appId,
        minerAddress: record.minerAddress,
        expectedOwnerPublic: record.publicKey,
        // 36s, matching the bot. It was 3s here, which is far less time than
        // the chain needs to publish the key after the user approves — the
        // dashboard gave up almost immediately and the connection appeared to
        // hang forever. The bot hit exactly this and was fixed long ago; these
        // two call sites were missed.
        maxAttempts: 30,
        intervalMs: 1200,
      });

      // First-tap verification must go through a real (very short) session.
      // add_tap() on a freshly constructed Miner always throws "No running
      // workers to add tap to" — start() is what spawns the workers. This
      // endpoint called add_tap() directly, so dashboard connect could never
      // succeed even after a perfectly good approval, while /miner_connect in
      // the bot worked because it already used this helper.
      // The isolated Bee worker performs the first real session. Keeping
      // verification out of the web process prevents duplicate event readers.

      // A plan covers one mining wallet. Connecting another wallet is valid,
      // but it must land paused when this account already has an active miner.
      // The Bee scheduler independently enforces the same rule as a final guard.
      const alreadyMining =
        !DASHBOARD_ADMIN_IDS.has(String(chatId)) &&
        state.miners.some(
          (miner) =>
            miner.chatId === chatId &&
            miner.id !== record.id &&
            miner.status === "active",
        );

      record.status = alreadyMining ? "stopped" : "active";
      record.lastError = null;
      writeBeeMinerState(state);

      console.log("Dashboard miner connection confirmed:", {
        chatId,
        walletName,
        status: record.status,
        alreadyMining,
      });

      res.json({
        ok: true,
        status: record.status,
        paused: alreadyMining,
      });
    } catch (error) {
      // Logged, not just returned. This swallowed the reason silently, so a
      // wallet that would not connect gave the operator nothing to go on.
      console.error("Dashboard miner check failed:", {
        chatId,
        walletName,
        expectedOwnerPublic: record.publicKey.slice(0, 16),
        message: error instanceof Error ? error.message : String(error),
      });

      res.status(409).json({
        ok: false,
        error: "NOT_YET_APPROVED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // --- Dashboard: buy a plan ---
  // Crypto payment lives here, on the dashboard; the bot sells with Telegram
  // Stars. This used to mint SHELL invoices behind the SHELL feature flag, so
  // it was both switched off and quoting the wrong asset.
  app.post("/api/dashboard/plan/buy", requireDashboardAuth, async (req: any, res) => {
    if (!TON_PAYMENTS_CHECK_ENABLED) {
      res.status(503).json({ ok: false, error: "PAYMENTS_NOT_LIVE" });
      return;
    }

    const chatId = req.telegramId;
    const planId = String(req.body?.planId || "").toLowerCase();
    const plan = getPlanById(planId);

    if (!plan) {
      res.status(400).json({ ok: false, error: "INVALID_PLAN" });
      return;
    }

    // Deliberately no "must already have an active mining wallet" check. The
    // invoice code identifies the payer, and requiring a wallet first
    // recreated the catch-22 where mining needed a subscription and a
    // subscription needed a miner.
    const paymentsState = readPaymentsState();
    const now = Date.now();

    // Reuse a live invoice rather than minting a second code for the same
    // plan — two open codes only invites paying the wrong one.
    const existing = paymentsState.pendingInvoices.find(
      (item: any) =>
        item.chatId === chatId &&
        item.planId === plan.id &&
        item.currency === "usdt" &&
        new Date(item.expiresAt).getTime() > now,
    );

    let invoice: any = existing;

    if (!invoice) {
      // Quote TON alongside USDT so the payer can use whichever they hold, and
      // lock the rate into the invoice so a price move during the payment
      // window costs nothing. No rate means USDT only — selling at a guessed
      // rate would be worse than offering one currency.
      let amountTonRaw: string | undefined;

      try {
        const rate = await fetchTonUsdRate(TONAPI_KEY);
        amountTonRaw = usdToTonRaw(plan.priceUsd, rate);
      } catch (error) {
        console.warn("Dashboard invoice: TON rate unavailable, USDT only:", {
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
      };

      paymentsState.pendingInvoices.push(invoice);
      writePaymentsState(paymentsState);
    }

    res.json({
      ok: true,
      currency: "usdt",
      network: "TON",
      address: TON_PAYMENTS_ADDRESS,
      code: invoice.code,
      amountUsdt: formatUsdtAmount(invoice.amountRaw),
      amountTon: invoice.amountTonRaw
        ? formatTonAmount(invoice.amountTonRaw)
        : null,
      expiresAt: invoice.expiresAt,
    });
  });

  // Native NACKL payments are matched by their exact amount. Each invoice
  // receives a sub-NACKL fractional marker, so neither a sender-wallet lookup
  // nor a memo field is required.
  app.post(
    "/api/dashboard/plan/nackl",
    requireDashboardAuth,
    (req: any, res) => {
      if (!NACKL_PAYMENTS_CHECK_ENABLED) {
        res.status(503).json({ ok: false, error: "NACKL_PAYMENTS_NOT_LIVE" });
        return;
      }

      const chatId = req.telegramId;
      const planId = String(req.body?.planId || "").toLowerCase();
      const plan = getPlanById(planId);

      if (!plan) {
        res.status(400).json({ ok: false, error: "INVALID_PLAN" });
        return;
      }

      const state = readPaymentsState();

      if (!state.nacklBaselineReady) {
        res.status(503).json({ ok: false, error: "NACKL_PAYMENTS_NOT_READY" });
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
        try {
          invoice = {
            id: `nackl:${chatId}:${plan.id}:${now}`,
            chatId,
            planId: plan.id,
            amountRaw: allocateNacklInvoiceAmountRaw(plan, state),
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + NACKL_INVOICE_EXPIRY_MS).toISOString(),
            currency: "nackl",
          };
        } catch (error) {
          res.status(503).json({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "NACKL_INVOICE_AMOUNT_CAPACITY_REACHED",
          });
          return;
        }
        state.pendingInvoices.push(invoice);
        writePaymentsState(state);
      }

      res.json({
        ok: true,
        currency: "nackl",
        network: "Acki Nacki",
        wallet: NACKL_PAYMENTS_WALLET_NAME,
        amountNackl: formatNacklAmount(invoice.amountRaw),
        expiresAt: invoice.expiresAt,
      });
    },
  );

  // Telegram Stars checkout for the dashboard. Telegram hosts the payment
  // sheet; the existing pre_checkout_query + successful_payment handlers in
  // bot.ts remain the single place that validates and credits the purchase.
  app.post(
    "/api/dashboard/plan/stars",
    requireDashboardAuth,
    async (req: any, res) => {
      const chatId = req.telegramId;
      const planId = String(req.body?.planId || "").toLowerCase();
      const plan = getPlanById(planId);

      if (!plan) {
        res.status(400).json({ ok: false, error: "INVALID_PLAN" });
        return;
      }

      if (!BOT_TOKEN) {
        res.status(503).json({ ok: false, error: "STARS_NOT_LIVE" });
        return;
      }

      const stars = getPlanStars(plan);

      try {
        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: `${plan.label} — ${plan.days} gün`,
              description: `Acki Nacki cloud mining for ${plan.days} days. Activates as soon as the payment clears.`,
              payload: `plan:${plan.id}:${chatId}`,
              currency: "XTR",
              prices: [
                {
                  label: `${plan.label} ${plan.days} gün`,
                  amount: stars,
                },
              ],
            }),
          },
        );
        const telegramData = (await telegramResponse.json()) as {
          ok?: boolean;
          result?: string;
          description?: string;
        };

        if (!telegramResponse.ok || !telegramData.ok || !telegramData.result) {
          console.error("Dashboard Stars invoice link failed:", {
            chatId,
            plan: plan.id,
            status: telegramResponse.status,
            description: telegramData.description || "UNKNOWN_TELEGRAM_ERROR",
          });
          res.status(502).json({ ok: false, error: "STARS_INVOICE_FAILED" });
          return;
        }

        console.log("Dashboard Stars invoice link created:", {
          chatId,
          plan: plan.id,
          stars,
        });
        res.json({
          ok: true,
          invoiceUrl: telegramData.result,
          stars,
        });
      } catch (error) {
        console.error("Dashboard Stars invoice link request failed:", {
          chatId,
          plan: plan.id,
          message: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({ ok: false, error: "STARS_INVOICE_FAILED" });
      }
    },
  );

  app.get("/", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "acki-bee-bot",
      time: new Date().toISOString(),
    });
  });

  // Fix: public, read-only stat for the ackinackiradar.com coming-soon page.
  // Intentionally its own route (not /api/stats, which belongs to the
  // separate Web3hunter Mining points system above) so it can't collide
  // with that unrelated app's data.
  // Public, read-only: chain stats + our own mining aggregate in one call, so
  // the landing page makes a single request instead of two. Chain half is
  // allowed to fail on its own (mainnet hiccup, rate limit) without taking the
  // mining half down with it — the page then just hides those tiles.
  app.get("/api/radar/stats", (_req, res) => {
    const mining = getRadarMiningStats();

    let chain: any = null;
    let chainStale = false;
    let chainAgeSeconds: number | null = null;

    // Public requests must never trigger the expensive blocks(last:300)
    // mainnet query. The background TPS sampler owns that read and refreshes
    // lastGoodChainStats on its normal cadence.
    if (lastGoodChainStats) {
      const ageMs = Date.now() - lastGoodChainStats.atMs;
      chainAgeSeconds = Math.round(ageMs / 1000);
      chainStale = ageMs > CHAIN_STATS_WARN_STALE_MS;

      if (ageMs <= CHAIN_STATS_MAX_SERVE_MS) {
        chain = lastGoodChainStats.data;
      }
    }

    res.json({
      ok: true,
      chain,
      chainStale,
      chainAgeSeconds,
      chainFlow: {
        consecutiveFailures: chainStatsConsecutiveFailures,
        beeCritical: isBeeChainCritical(),
        blockedByBee: chainStatsLastBlockedByBee,
        criticalRefreshSeconds: TPS_BEE_CRITICAL_REFRESH_MS / 1000,
        lastAttemptAt:
          chainStatsLastAttemptAtMs === null
            ? null
            : new Date(chainStatsLastAttemptAtMs).toISOString(),
        criticalRefreshDueAt:
          Math.max(lastGoodChainStats?.atMs || 0, chainStatsLastAttemptAtMs || 0) > 0
            ? new Date(
                Math.max(lastGoodChainStats?.atMs || 0, chainStatsLastAttemptAtMs || 0) +
                  TPS_BEE_CRITICAL_REFRESH_MS,
              ).toISOString()
            : null,
        nextAttemptAt:
          chainStatsNextAttemptAtMs === null
            ? null
            : new Date(chainStatsNextAttemptAtMs).toISOString(),
      },
      mining,
      tpsHistory: getTpsHistorySummary(),
    });
  });

  // --- Admin overview ---
  //
  // Deliberately read-only apart from the two repair actions below. Everything
  // here already exists in the data files; the value is having it in one place
  // instead of over SSH.
  app.get("/api/admin/overview", requireAdminAuth, (_req: any, res) => {
    const now = Date.now();
    const users = readUsers();
    const minerState = readBeeMinerState();
    const payments = readPaymentsState();
    const monitor = (() => {
      try {
        const file = path.join(process.cwd(), "data", "mining-monitor.json");
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return Array.isArray(parsed?.watches) ? parsed.watches : [];
      } catch {
        return [];
      }
    })();

    const byStatus: Record<string, number> = {};
    for (const miner of minerState.miners) {
      byStatus[miner.status] = (byStatus[miner.status] || 0) + 1;
    }

    const subs = Object.entries(payments.subscriptions || {}).map(
      ([chatId, sub]: any) => ({
        chatId: Number(chatId),
        planId: sub.planId,
        trial: Boolean(sub.trial),
        activeUntil: sub.activeUntil,
        active: new Date(sub.activeUntil).getTime() > now,
      }),
    );

    res.json({
      ok: true,
      users: {
        total: users.length,
        // Telegram sign-ins are the ones with a positive id; negatives are
        // leftovers from the removed wallet-name login.
        telegram: users.filter((u: any) => Number(u.telegramId) > 0).length,
        list: users.map((u: any) => ({
          telegramId: u.telegramId,
          firstName: u.firstName ?? null,
          username: u.username ?? null,
          referralCode: u.referralCode ?? null,
          referredBy: u.referredBy ?? null,
          points: u.points ?? 0,
          createdAt: u.createdAt ?? null,
        })),
      },
      miners: {
        total: minerState.miners.length,
        byStatus,
        list: minerState.miners.map((m) => ({
          chatId: m.chatId,
          walletName: m.walletName,
          status: m.status,
          lastError: m.lastError,
          lastSessionAt: m.lastSessionAt ?? null,
          lastRewardAt: m.lastRewardAt ?? null,
          lastTapSum: (m as any).lastTapSum ?? null,
          createdAt: m.createdAt,
        })),
      },
      subscriptions: {
        total: subs.length,
        active: subs.filter((s) => s.active).length,
        // Written by the bot; the server's PaymentsState type does not
        // declare these two, so they are read loosely.
        trials: ((payments as any).trialUsed || []).length,
        list: subs,
      },
      payments: {
        pendingInvoices: (payments.pendingInvoices || []).length,
        starsCharges: ((payments as any).starsCharges || []).length,
        tonLastLt: (payments as any).tonLastLt ?? 0,
        pendingInvoiceList: (payments.pendingInvoices || []).map((inv: any) => ({
          chatId: inv.chatId ?? null,
          planId: inv.planId ?? null,
          code: inv.code ?? null,
          amount: inv.amount ?? inv.amountRaw ?? null,
          currency: inv.currency ?? null,
          createdAt: inv.createdAt ?? null,
          expiresAt: inv.expiresAt ?? null,
        })),
        starsChargeList: ((payments as any).starsCharges || []).slice(-100),
        trialUsedList: ((payments as any).trialUsed || []),
      },
      radar: {
        watches: monitor.length,
        systemWatches: monitor.filter((w: any) => w.chatId === 0).length,
        list: monitor.map((w: any) => ({
          chatId: w.chatId ?? null,
          label: w.label ?? null,
          input: w.input ?? null,
          lastCheckedAt: w.lastCheckedAt ?? null,
          lastEventAt:
            Array.isArray(w.events) && w.events.length
              ? w.events[w.events.length - 1]?.at ?? null
              : null,
          eventCount: Array.isArray(w.events) ? w.events.length : 0,
        })),
      },
      updatedAt: new Date().toISOString(),
    });
  });

  // Repair action: drop a miner record (and its stored keys) for any user.
  app.post("/api/admin/miner/remove", requireAdminAuth, (req: any, res) => {
    const chatId = Number(req.body?.chatId);
    const walletName = String(req.body?.walletName || "").trim();
    const state = readBeeMinerState();
    const record = state.miners.find(
      (m) => m.chatId === chatId && m.walletName === walletName,
    );

    if (!record) {
      res.status(404).json({ ok: false, error: "MINER_NOT_FOUND" });
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

    console.log("Admin removed miner:", {
      byAdmin: req.telegramId,
      chatId,
      walletName,
    });

    res.json({ ok: true });
  });

  // Repair action: grant days to an account by hand — for a payment that
  // arrived without a usable code, or an apology.
  app.post("/api/admin/subscription/grant", requireAdminAuth, (req: any, res) => {
    const chatId = Number(req.body?.chatId);
    const days = Number(req.body?.days);
    const planId = String(req.body?.planId || "standard");

    if (!Number.isFinite(chatId) || !Number.isFinite(days) || days <= 0) {
      res.status(400).json({ ok: false, error: "INVALID_INPUT" });
      return;
    }

    const state = readPaymentsState();
    const existing = state.subscriptions[String(chatId)];
    const base =
      existing && new Date(existing.activeUntil).getTime() > Date.now()
        ? new Date(existing.activeUntil).getTime()
        : Date.now();
    const activeUntil = new Date(
      base + days * 24 * 60 * 60 * 1000,
    ).toISOString();

    state.subscriptions[String(chatId)] = { planId, activeUntil } as any;
    writePaymentsState(state);

    console.log("Admin granted subscription:", {
      byAdmin: req.telegramId,
      chatId,
      planId,
      days,
      activeUntil,
    });

    res.json({ ok: true, activeUntil });
  });

  // Admin-panel on/off toggle for /testmode (see bot.ts). Same session as
  // the rest of the admin surface, so no separate auth path to maintain.
  app.get("/api/admin/testmode", requireAdminAuth, (req: any, res) => {
    res.json({ ok: true, active: isAdminTestModeOn(req.telegramId) });
  });

  app.post("/api/admin/testmode", requireAdminAuth, (req: any, res) => {
    const on = req.body?.on === true;
    setAdminTestMode(req.telegramId, on);
    res.json({ ok: true, active: on });
  });

  // Revokes a subscription outright (as opposed to /grant, which only ever
  // extends). Used by the panel's per-row "kaldir" button.
  app.post("/api/admin/subscription/revoke", requireAdminAuth, (req: any, res) => {
    const chatId = Number(req.body?.chatId);

    if (!Number.isFinite(chatId)) {
      res.status(400).json({ ok: false, error: "INVALID_INPUT" });
      return;
    }

    const state = readPaymentsState();
    const had = Boolean(state.subscriptions[String(chatId)]);
    delete state.subscriptions[String(chatId)];
    writePaymentsState(state);

    console.log("Admin revoked subscription:", { byAdmin: req.telegramId, chatId, had });

    res.json({ ok: true, revoked: had });
  });

  // Push a plain-text Telegram message to any chat id from the admin panel.
  // Same bot the user already talks to \u2014 no separate messaging channel.
  app.post("/api/admin/notify", requireAdminAuth, async (req: any, res) => {
    const chatId = Number(req.body?.chatId);
    const message = String(req.body?.message || "").trim();

    if (!Number.isFinite(chatId) || !message) {
      res.status(400).json({ ok: false, error: "INVALID_INPUT" });
      return;
    }

    try {
      await sendAdminNotification(chatId, message);
      console.log("Admin sent notification:", { byAdmin: req.telegramId, chatId, length: message.length });
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Admin notification failed:", { chatId, message: error?.message });
      res.status(502).json({ ok: false, error: "SEND_FAILED", detail: String(error?.message || error) });
    }
  });

  app.get("/api/radar/wallet-count", (_req, res) => {
    res.json({
      count: getMiningMonitorWalletCount(),
      updatedAt: new Date().toISOString(),
    });
  });

app.get("/api/acki/network", (_req, res) => {
  const snapshot = lastGoodChainStats;

  // Network stats are sampled centrally by startTpsSampler().
  // HTTP traffic must never create its own provider / GraphQL request.
  if (!snapshot) {
    res.status(503).json({
      ok: false,
      error: "ACKI_NETWORK_CACHE_EMPTY",
      cached: true,
    });
    return;
  }

  const ageMs = Math.max(0, Date.now() - snapshot.atMs);

  res.json({
    ok: true,
    network: snapshot.data,
    cached: true,
    stale: ageMs > CHAIN_STATS_WARN_STALE_MS,
    expired: ageMs > CHAIN_STATS_MAX_SERVE_MS,
    ageSeconds: Math.round(ageMs / 1000),
  });
});

app.get("/api/acki/wallet/:input", async (req, res) => {
  try {
    const input = String(req.params.input || "");
    const wallet = await getAckiWalletActivity(input);

    res.json({
      ok: true,
      wallet,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ACKI_WALLET_UNAVAILABLE";
    console.error("Acki wallet endpoint error:", error);

    if (message === "INVALID_ACKI_WALLET_INPUT") {
      res.status(400).json({
        ok: false,
        error: "INVALID_ACKI_WALLET_INPUT",
      });
      return;
    }

    if (message === "ACKI_NAME_RESOLUTION_SDK_UNAVAILABLE") {
      res.status(500).json({
        ok: false,
        error: "ACKI_NAME_RESOLUTION_SDK_UNAVAILABLE",
      });
      return;
    }

    if (
      message === "ACKI_NAME_NOT_FOUND" ||
      message === "ACKI_NAME_RESOLUTION_FAILED" ||
      message === "ACKI_WALLET_NOT_FOUND"
    ) {
      res.status(404).json({
        ok: false,
        error: message,
      });
      return;
    }

    res.status(502).json({
      ok: false,
      error: "ACKI_WALLET_UNAVAILABLE",
    });
  }
});

  app.get("/api/stats", (_req, res) => {
    const users = readUsers();

    res.json({
      totalUsers: users.length,
      totalPoints: users.reduce((sum, user) => sum + user.points, 0),
    });
  });

  app.get("/api/leaderboard", (_req, res) => {
    const users = readUsers();

    const topUsers = [...users]
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)
      .map((user) => ({
        firstName: user.firstName,
        username: user.username,
        points: user.points,
      }));

    res.json({
      users: topUsers,
    });
  });

  app.get("/api/users/:telegramId", requireUserAuth, (req: any, res) => {
    const telegramId = Number(req.params.telegramId);

    if (!Number.isSafeInteger(telegramId) || telegramId !== req.telegramId) {
      res.status(403).json({ ok: false, error: "FORBIDDEN" });
      return;
    }

    const users = readUsers();
    const user = users.find((item) => item.telegramId === telegramId);

    if (!user) {
      res.status(404).json({
        user: null,
        mining: {
          active: false,
          minutes: 0,
          power: 0,
          hash: 0,
        },
      });
      return;
    }

    const botUsername = process.env.BOT_USERNAME || "ANweb3hunterbot";
    const referralLink = "https://t.me/" + botUsername + "?start=" + user.referralCode;

    res.json({
      user: {
        ...user,
        referralLink,
      },
      mining: getMiningStatus(user),
    });
  });
 app.get("/api/tasks/:telegramId", requireUserAuth, (req: any, res) => {
  const telegramId = Number(req.params.telegramId);

  if (!Number.isSafeInteger(telegramId) || telegramId !== req.telegramId) {
    res.status(403).json({ ok: false, error: "FORBIDDEN" });
    return;
  }

  const users = readUsers();
  const user = users.find((item) => item.telegramId === telegramId);

  if (!user) {
    res.status(404).json({
      tasks: [],
    });
    return;
  }

  const completedTasks = user.completedTasks || [];

  res.json({
    tasks: TASKS.map((task) => ({
      ...task,
      completed: completedTasks.includes(task.id),
    })),
  });
});
app.post("/api/tasks/:telegramId/:taskId/complete", requireUserAuth, (req: any, res) => {
  const telegramId = Number(req.params.telegramId);
  const taskId = req.params.taskId;

  if (!Number.isSafeInteger(telegramId) || telegramId !== req.telegramId) {
    res.status(403).json({ ok: false, error: "FORBIDDEN" });
    return;
  }

  const users = readUsers();
  const user = users.find((item) => item.telegramId === telegramId);

  if (!user) {
    res.status(404).json({
      ok: false,
      message: "Kullanıcı bulunamadı.",
    });
    return;
  }

  const task = TASKS.find((item) => item.id === taskId);

  if (!task) {
    res.status(404).json({
      ok: false,
      message: "Görev bulunamadı.",
    });
    return;
  }

  if (!user.completedTasks) {
    user.completedTasks = [];
  }

  if (user.completedTasks.includes(task.id)) {
    res.json({
      ok: true,
      alreadyCompleted: true,
      message: "Bu görev zaten tamamlandı.",
      user,
      task,
    });
    return;
  }

  user.completedTasks.push(task.id);
  user.points += task.reward;

  writeUsers(users);

  res.json({
    ok: true,
    alreadyCompleted: false,
    message: "Görev tamamlandı.",
    reward: task.reward,
    user,
    task,
  });
});
  app.listen(port, "127.0.0.1", () => {
    console.log("Web server çalışıyor: http://localhost:" + port);
    startTpsSampler();

    // Chain-sampled reward feed for the dashboard monitor. Fire-and-forget on
    // an interval; every failure path inside already degrades to "skip this
    // sample", so it can never take the web server down with it.
    void runRewardFeedPoll();
    setInterval(() => {
      void runRewardFeedPoll();
    }, REWARD_FEED_POLL_MS);
  });
}
