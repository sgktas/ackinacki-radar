import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getAckiNetworkStats, getAckiWalletActivity } from "./services/ackiProvider";
import {
  collectReward as beeCollectReward,
  createMiner as beeCreateMiner,
  generateMiningKeys as beeGenerateMiningKeys,
  resolveMinerAddress as beeResolveMinerAddress,
  waitForMiningKeyPropagation as beeWaitForMiningKeyPropagation,
} from "./services/beeMiner";
import { getPlanById, PLANS } from "./services/payments";

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

// Self-correcting cadence: schedule the next run from the wall clock, not from
// "now + interval" after the work finished. A slow mainnet round must not push
// every later sample further out (that drift compounds — learned the hard way
// on the mining monitor).
function startTpsSampler() {
  const FIRST_DELAY_MS = 5000;

  // nextAt must track when the FIRST tick actually runs. Seeding it with
  // now + INTERVAL while the first tick fires after FIRST_DELAY made the
  // second sample land a full interval late (~115s instead of 60s) before
  // the cadence settled.
  let nextAt = Date.now() + FIRST_DELAY_MS;

  const tick = async () => {
    try {
      const stats = await getAckiNetworkStats();
      if (stats && typeof stats.tps === "number") {
        recordTpsSample(stats.tps);
      }
    } catch (error) {
      // A missed sample is fine; the windows are averages over many.
    }

    nextAt += TPS_SAMPLE_INTERVAL_MS;
    let delay = nextAt - Date.now();

    // Fell behind (slow mainnet, suspended process): resync to the next slot
    // instead of firing a burst of catch-up ticks.
    if (delay < 1000) {
      nextAt = Date.now() + TPS_SAMPLE_INTERVAL_MS;
      delay = TPS_SAMPLE_INTERVAL_MS;
    }

    setTimeout(tick, delay);
  };

  setTimeout(tick, FIRST_DELAY_MS);
  console.log("TPS sampler started:", { intervalSeconds: TPS_SAMPLE_INTERVAL_MS / 1000 });
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
const REWARD_FEED_POLL_MS = Number(process.env.REWARD_FEED_POLL_MS || 30000);
const REWARD_FEED_MAX = 100;
const REWARD_NACKL_CURRENCY = 1;

type RewardTick = { at: string; amount: number };

const rewardFeed = new Map<string, RewardTick[]>();
const rewardLastTotal = new Map<string, number>();

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

async function pollRewardFeed(): Promise<void> {
  const miners = readBeeMinerState().miners.filter(
    (m) => m.status === "active" || m.status === "stopped",
  );

  const watches = readMiningWatchesForRewards();

  for (const miner of miners) {
    const popit = watches.get(miner.walletName);

    if (!popit) {
      continue;
    }

    const total = await readLockedNackl(popit);

    if (total == null) {
      continue;
    }

    const previous = rewardLastTotal.get(miner.walletName);
    rewardLastTotal.set(miner.walletName, total);

    // First sample only establishes the baseline — a "delta" against nothing
    // would show the entire lifetime balance as one giant fake reward.
    if (previous == null || total <= previous) {
      continue;
    }

    const feed = rewardFeed.get(miner.walletName) ?? [];
    feed.push({ at: new Date().toISOString(), amount: total - previous });
    rewardFeed.set(miner.walletName, feed.slice(-REWARD_FEED_MAX));
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
};

type Subscription = { planId: string; activeUntil: string };

type PaymentsState = {
  lastCheckedBalanceRaw: string | null;
  pendingInvoices: PendingInvoice[];
  subscriptions: Record<string, Subscription>;
  seenMessageIds: string[];
};

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
    lastCheckedBalanceRaw: parsed?.lastCheckedBalanceRaw ?? null,
    pendingInvoices: Array.isArray(parsed?.pendingInvoices) ? parsed.pendingInvoices : [],
    subscriptions: parsed?.subscriptions && typeof parsed.subscriptions === "object" ? parsed.subscriptions : {},
    seenMessageIds: Array.isArray(parsed?.seenMessageIds) ? parsed.seenMessageIds : [],
  };
}

function writePaymentsState(state: PaymentsState) {
  ensureStorage();
  fs.writeFileSync(paymentsFile, JSON.stringify(state, null, 2), "utf-8");
}

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const SESSION_SECRET = process.env.DASHBOARD_SESSION_SECRET || BOT_TOKEN || "insecure-dev-secret";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PAYMENTS_WALLET_NAME = process.env.PAYMENTS_WALLET_NAME || "ackinackiradarpayments";
const BEE_APP_ID = process.env.BEE_APP_ID || "";
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

  if (computedHash !== hash) return false;

  const authDate = Number(rest.auth_date) * 1000;
  if (!authDate || Date.now() - authDate > 24 * 60 * 60 * 1000) return false;

  return true;
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

  if (expectedSignature !== signature) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (!payload?.telegramId || Date.now() > payload.exp) return null;
    return Number(payload.telegramId);
  } catch {
    return null;
  }
}

function requireDashboardAuth(req: any, res: any, next: any) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const telegramId = verifySession(token);

  if (!telegramId) {
    res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
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
const DASHBOARD_PATH = "/dashboard.html";

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

  app.use(cors());
  app.use(express.json());
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
      };

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
        maxAttempts: 3,
        intervalMs: 1000,
      });

      const handle = await beeCreateMiner({
        appId: record.appId,
        minerAddress: record.minerAddress,
        publicKey: record.publicKey,
        secretKey: record.secretKey,
      });

      handle.miner.add_tap(Math.floor(Math.random() * 1000), Math.floor(Math.random() * 1000));

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
      }));

    const subscription = paymentsState.subscriptions[String(chatId)] || null;

    res.json({
      ok: true,
      miners,
      subscription,
      plans: PLANS.map((plan) => ({
        id: plan.id,
        label: plan.label,
        days: plan.days,
        priceUsd: plan.priceUsd,
        priceShellRaw: plan.priceShellRaw,
      })),
      paymentsWallet: PAYMENTS_WALLET_NAME,
      cycle: {
        tapCap: BEE_CYCLE_TAP_CAP,
        hours: BEE_CYCLE_HOURS,
        tapsPerSession: BEE_MINING_TAP_COUNT,
        sessionIntervalSeconds: BEE_MINING_INTERVAL_SECONDS,
      },
      // Newest first for the dashboard monitor. Sampled off chain by
      // pollRewardFeed, not taken from the bot's notification pipeline.
      rewards: miners.flatMap((m) =>
        (rewardFeed.get(m.walletName) ?? [])
          .slice()
          .reverse()
          .map((tick) => ({ ...tick, walletName: m.walletName })),
      ),
      rewardFeedPollSeconds: Math.round(REWARD_FEED_POLL_MS / 1000),
    });
  });

  // --- Dashboard: pause / resume cloud mining ---
  // The tick only picks up miners whose status is "active", so pausing is just
  // a status flip. Deliberately refuses to touch a miner that is in
  // "pending_authorization" or "error": those need the connect/check flow, and
  // silently marking them active would put a broken miner back into rotation.
  function setMinerRunning(req: any, res: any, shouldRun: boolean) {
    const chatId = req.telegramId;
    const walletName = String(req.body?.walletName || "").trim();
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

    record.status = shouldRun ? "active" : "stopped";
    record.lastError = null;
    writeBeeMinerState(state);

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

    try {
      const keys = await beeGenerateMiningKeys(BEE_APP_ID);
      const minerAddress = await beeResolveMinerAddress({ appId: BEE_APP_ID, walletName });

      const state = readBeeMinerState();
      const id = `${chatId}:${walletName}`;
      const existingIndex = state.miners.findIndex((m) => m.id === id);

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
      };

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
        maxAttempts: 3,
        intervalMs: 1000,
      });

      const handle = await beeCreateMiner({
        appId: record.appId,
        minerAddress: record.minerAddress,
        publicKey: record.publicKey,
        secretKey: record.secretKey,
      });

      handle.miner.add_tap(Math.floor(Math.random() * 1000), Math.floor(Math.random() * 1000));

      record.status = "active";
      record.lastError = null;
      writeBeeMinerState(state);

      res.json({ ok: true, status: "active" });
    } catch (error) {
      res.status(409).json({
        ok: false,
        error: "NOT_YET_APPROVED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // --- Dashboard: buy a plan ---
  app.post("/api/dashboard/plan/buy", requireDashboardAuth, (req: any, res) => {
    const chatId = req.telegramId;
    const planId = String(req.body?.planId || "").toLowerCase();
    const plan = getPlanById(planId);

    if (!plan) {
      res.status(400).json({ ok: false, error: "INVALID_PLAN" });
      return;
    }

    const minerState = readBeeMinerState();
    const activeMiners = minerState.miners.filter(
      (miner) => miner.chatId === chatId && miner.status === "active",
    );

    if (!activeMiners.length) {
      res.status(409).json({ ok: false, error: "NO_ACTIVE_WALLET" });
      return;
    }

    const paymentsState = readPaymentsState();
    const now = Date.now();
    const invoice: PendingInvoice = {
      id: `${chatId}:${plan.id}:${now}`,
      chatId,
      planId: plan.id,
      amountRaw: plan.priceShellRaw,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
    };

    paymentsState.pendingInvoices.push(invoice);
    writePaymentsState(paymentsState);

    res.json({
      ok: true,
      amountRaw: plan.priceShellRaw,
      paymentsWallet: PAYMENTS_WALLET_NAME,
      walletNames: activeMiners.map((m) => m.walletName),
      expiresAt: invoice.expiresAt,
    });
  });

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
  app.get("/api/radar/stats", async (_req, res) => {
    const mining = getRadarMiningStats();
    let chain: any = null;

    try {
      chain = await getAckiNetworkStats();
    } catch (error) {
      console.error("Radar stats: chain half failed:", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    res.json({ ok: true, chain, mining, tpsHistory: getTpsHistorySummary() });
  });

  app.get("/api/radar/wallet-count", (_req, res) => {
    res.json({
      count: getMiningMonitorWalletCount(),
      updatedAt: new Date().toISOString(),
    });
  });

app.get("/api/acki/network", async (_req, res) => {
  try {
    const network = await getAckiNetworkStats();

    res.json({
      ok: true,
      network,
    });
  } catch (error) {
    console.error("Acki network endpoint error:", error);

    res.status(502).json({
      ok: false,
      error: "ACKI_NETWORK_UNAVAILABLE",
    });
  }
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

  app.get("/api/users/:telegramId", (req, res) => {
    const telegramId = Number(req.params.telegramId);
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
app.get("/api/tasks/:telegramId", (req, res) => {
  const telegramId = Number(req.params.telegramId);
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
app.post("/api/tasks/:telegramId/:taskId/complete", (req, res) => {
  const telegramId = Number(req.params.telegramId);
  const taskId = req.params.taskId;

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
  app.listen(port, () => {
    console.log("Web server çalışıyor: http://localhost:" + port);
    startTpsSampler();

    // Chain-sampled reward feed for the dashboard monitor. Fire-and-forget on
    // an interval; every failure path inside already degrades to "skip this
    // sample", so it can never take the web server down with it.
    void pollRewardFeed();
    setInterval(() => {
      void pollRewardFeed();
    }, REWARD_FEED_POLL_MS);
  });
}
