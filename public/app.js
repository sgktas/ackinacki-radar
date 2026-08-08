const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

if (tg) {
  tg.ready();
  tg.expand();
}

const urlParams = new URLSearchParams(window.location.search);
const queryUserId = urlParams.get("userId");
const telegramUserId =
  tg && tg.initDataUnsafe && tg.initDataUnsafe.user
    ? tg.initDataUnsafe.user.id
    : null;

const currentUserId = queryUserId || telegramUserId;

let appState = {
  user: null,
  mining: null,
  tasks: [],
  leaderboard: [],
  stats: null,
  network: null,
  wallet: null,
};
async function fetchJson(url, options) {
  const res = await fetch(url, options);

  if (!res.ok) {
    throw new Error("API hatası: " + res.status);
  }

  return res.json();
}

function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "Soon";
  }

  return new Intl.NumberFormat("en-US").format(number);
}

function formatTime(value) {
  if (!value) {
    return "Live";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Live";
  }

  return date.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDisplayName(user) {
  if (!user) return "-";

  if (user.username) {
    return "@" + user.username;
  }

  return user.firstName || "Kullanıcı";
}

function getLevel(points) {
  const safePoints = Number(points || 0);
  return Math.max(1, Math.floor(safePoints / 250) + 1);
}

function renderNetworkPending() {
  setText("networkTps", "Soon");
  setText("networkBlock", "Loading");
  setText("networkEpoch", "Soon");
}

async function loadAckiNetworkStats() {
  renderNetworkPending();

  try {
    const result = await fetchJson("/api/acki/network");
    const network = result && result.network ? result.network : null;

    if (!network) {
      throw new Error("Network data missing");
    }

appState.network = network;
    setText("networkBlock", formatNumber(network.latestBlock));
    setText("networkTps", network.tps === null ? "Soon" : formatNumber(network.tps));
    setText("networkEpoch", network.epoch === null ? "Soon" : formatNumber(network.epoch));


 } catch (error) {
  console.error("Acki network data could not be loaded:", error);

  appState.network = null;

  setText("networkTps", "Soon");
  setText("networkBlock", "Offline");
  setText("networkEpoch", "Soon");
}
}

function renderProfile(user) {
  appState.user = user;

  if (!user) {
    setText("userPoints", "-");
    setText("avatar", "A");
    setText("profileAvatar", "A");
    setText("homeUserName", "Kullanıcı bulunamadı");
    setText("profileName", "Kullanıcı bulunamadı");
    setText("profileUserId", "-");
    setText("referral", "Kullanıcı bulunamadı.");

    const profileBox = document.getElementById("profileBox");

    if (profileBox) {
      profileBox.innerHTML = '<div class="loading">Önce botta /start yaz.</div>';
    }

    return;
  }

  const displayName = getDisplayName(user);
  const firstLetter = (user.firstName || user.username || "A").slice(0, 1).toUpperCase();
  const level = getLevel(user.points);

  setText("userPoints", user.points);
  setText("avatar", firstLetter);
  setText("profileAvatar", firstLetter);
  setText("homeUserName", displayName);
  setText("profileName", displayName);
  setText("profileUserId", "ID " + String(user.telegramId || "-"));
  setText("referral", user.referralLink || "-");

  const profileBox = document.getElementById("profileBox");

  if (profileBox) {
    profileBox.innerHTML =
      '<div class="row"><span>Season XP</span><strong>' +
      escapeHtml(user.points) +
      " XP</strong></div>" +
      '<div class="row"><span>Level</span><strong>' +
      escapeHtml(level) +
      "</strong></div>" +
      '<div class="row"><span>Kullanıcı adı</span><strong>' +
      escapeHtml(user.username ? "@" + user.username : "-") +
      "</strong></div>" +
      '<div class="row"><span>Son claim</span><strong>' +
      escapeHtml(user.lastClaimDate || "-") +
      "</strong></div>" +
      '<div class="row"><span>Referral code</span><strong>' +
      escapeHtml(user.referralCode || "-") +
      "</strong></div>" +
      '<div class="row"><span>Wallet</span><strong>Soon</strong></div>';
  }
}


function formatUnixTime(seconds) {
  const value = Number(seconds || 0);

  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  return new Date(value * 1000).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortAddress(value) {
  const text = String(value || "");

  if (text.length <= 18) {
    return text || "-";
  }

  return text.slice(0, 8) + "..." + text.slice(-8);
}

function addThousandsSeparator(value) {
  return String(value || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatWalletDisplayAmount(value, decimals) {
  const precision = typeof decimals === "number" ? decimals : 2;
  const raw = String(value || "0").trim().replace(/,/g, "");

  if (!raw || !/^[+-]?\d+(\.\d+)?$/.test(raw)) {
    return "0";
  }

  const negative = raw.charAt(0) === "-";
  const normalized = raw.replace(/^[+-]/, "");
  const parts = normalized.split(".");
  let whole = BigInt(parts[0] || "0");
  const fraction = parts[1] || "";

  if (precision <= 0) {
    if (Number(fraction.charAt(0) || "0") >= 5) {
      whole += 1n;
    }

    const wholeOnly = addThousandsSeparator(whole.toString());
    return negative && wholeOnly !== "0" ? "-" + wholeOnly : wholeOnly;
  }

  const padded = fraction.padEnd(precision + 1, "0");
  let kept = padded.slice(0, precision);
  const roundDigit = Number(padded.charAt(precision) || "0");

  if (roundDigit >= 5) {
    const roundedFraction = (BigInt(kept || "0") + 1n).toString().padStart(precision, "0");

    if (roundedFraction.length > precision) {
      whole += 1n;
      kept = "0".repeat(precision);
    } else {
      kept = roundedFraction;
    }
  }

  if (whole === 0n && /^0+$/.test(kept)) {
    return "0";
  }

  const result = addThousandsSeparator(whole.toString()) + "." + kept;
  return negative ? "-" + result : result;
}

function renderWalletResult(wallet) {
  const target = document.getElementById("walletResult");

  if (!target) return;

  if (!wallet) {
    target.innerHTML = '<div class="loading compact">Cüzdan adı veya adres gir.</div>';
    return;
  }

  const tokens = wallet.tokens || [];
  const tokenRows = tokens.length
    ? tokens
        .map(function (token) {
          return (
            '<div class="wallet-token">' +
            '<span>' +
            escapeHtml(token.symbol || "Token") +
            '<small>Currency ' +
            escapeHtml(token.currency) +
            "</small></span>" +
            "<strong>" +
            escapeHtml(formatWalletDisplayAmount(token.balanceFormatted || "0")) +
            "</strong>" +
            "</div>"
          );
        })
        .join("")
    : '<div class="loading compact">Token bakiyesi bulunamadı.</div>';

  target.innerHTML =
    '<div class="wallet-card">' +
    '<div class="wallet-card-head">' +
    '<span>' +
    escapeHtml(wallet.inputType === "name" ? "Resolved wallet" : "Wallet") +
    "</span>" +
    '<strong title="' +
    escapeHtml(wallet.address) +
    '">' +
    escapeHtml(shortAddress(wallet.address)) +
    "</strong>" +
    "</div>" +
    (wallet.name
      ? '<div class="wallet-note">Name: ' + escapeHtml(wallet.name) + "</div>"
      : "") +
    '<div class="wallet-tokens">' +
    tokenRows +
    "</div>" +
    '<div class="wallet-meta">' +
    '<span>Last paid</span><strong>' +
    escapeHtml(formatUnixTime(wallet.lastPaid)) +
    "</strong>" +
    "</div>" +
    '<div class="wallet-meta">' +
    '<span>Last LT</span><strong>' +
    escapeHtml(wallet.lastTransactionLt || "-") +
    "</strong>" +
    "</div>" +
    "</div>";
}

function renderWalletError(message) {
  const target = document.getElementById("walletResult");

  if (!target) return;

  target.innerHTML =
    '<div class="wallet-error">' +
    escapeHtml(message || "Wallet bilgisi alınamadı.") +
    "</div>";
}

async function lookupWallet() {
  const input = document.getElementById("walletInput");
  const button = document.getElementById("walletLookupButton");
  const target = document.getElementById("walletResult");
  const value = input ? input.value.trim() : "";

  if (!value) {
    renderWalletError("Cüzdan adı veya adres gir.");
    return;
  }

  if (target) {
    target.innerHTML = '<div class="loading compact">Mainnet sorgulanıyor...</div>';
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Sorgulanıyor";
  }

  try {
    const result = await fetchJson("/api/acki/wallet/" + encodeURIComponent(value));
    const wallet = result && result.wallet ? result.wallet : null;

    appState.wallet = wallet;
    renderWalletResult(wallet);
  } catch (error) {
    console.error("Wallet lookup failed:", error);
    renderWalletError("Wallet bulunamadı veya sorgu tamamlanamadı.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Sorgula";
    }
  }
}

function setupWalletLookup() {
  const input = document.getElementById("walletInput");
  const button = document.getElementById("walletLookupButton");

  if (!input || !button) return;

  button.addEventListener("click", lookupWallet);
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      lookupWallet();
    }
  });
}

function renderMiningState(mining) {
  appState.mining = mining;

  const isActive = mining && mining.active;

  setText("homeMiningBadge", isActive ? "Radar aktif" : "Radar hazır");
}

function renderLeaderboard(users) {
  appState.leaderboard = users || [];

  const target = document.getElementById("leaderboard");

  if (!target) return;

  if (!users || !users.length) {
    target.innerHTML = '<div class="loading">Henüz sıralama verisi yok.</div>';
    return;
  }

  target.innerHTML = users
    .map(function (user, index) {
      const name = user.username ? "@" + user.username : user.firstName;

      return (
        '<div class="leader">' +
        "<span>" +
        (index + 1) +
        ". " +
        escapeHtml(name || "Kullanıcı") +
        "</span>" +
        "<strong>" +
        escapeHtml(user.points) +
        " XP</strong>" +
        "</div>"
      );
    })
    .join("");
}

function getQuestTypeLabel(task) {
  const title = String(task.title || "").toLowerCase();

  if (title.includes("mining") || title.includes("mine")) {
    return "Mining Quest";
  }

  if (title.includes("ref") || title.includes("invite") || title.includes("davet")) {
    return "Social Quest";
  }

  if (title.includes("learn") || title.includes("oku") || title.includes("öğren")) {
    return "Learn Quest";
  }

  return "Radar Quest";
}

function buildTaskRow(task) {
  const action = task.completed
    ? '<span class="status-pill done">✅ Tamamlandı</span>'
    : '<button class="task-btn" data-task-id="' +
      escapeHtml(task.id) +
      '">Tamamla</button>';

  return (
    '<div class="row">' +
    "<span>" +
    escapeHtml(task.title) +
    "<br><small>" +
    escapeHtml(getQuestTypeLabel(task)) +
    " • +" +
    escapeHtml(task.reward) +
    " XP</small></span>" +
    action +
    "</div>"
  );
}

function bindTaskButtons(container) {
  const buttons = container.querySelectorAll(".task-btn");

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      completeTaskFromDashboard(button.getAttribute("data-task-id"));
    });
  });
}

function renderTasks(tasks) {
  appState.tasks = tasks || [];

  const target = document.getElementById("tasksList");

  if (!target) return;

  if (!tasks || !tasks.length) {
    target.innerHTML = '<div class="loading">Henüz quest yok.</div>';
    return;
  }

  target.innerHTML = tasks
    .map(function (task) {
      return buildTaskRow(task);
    })
    .join("");

  bindTaskButtons(target);
}
function renderHomeTasks(tasks) {
  const target = document.getElementById("homeTasks");

  if (!target) return;

  if (!tasks || !tasks.length) {
    target.innerHTML = '<div class="loading">Henüz quest yok.</div>';
    return;
  }

  const incomplete = tasks.filter(function (task) {
    return !task.completed;
  });

  const list = incomplete.length ? incomplete.slice(0, 3) : tasks.slice(0, 3);

  target.innerHTML = list
    .map(function (task) {
      return buildTaskRow(task);
    })
    .join("");

  bindTaskButtons(target);
}

function renderHomeSummary() {
  const target = document.getElementById("homeSummary");

  if (!target) return;

  const user = appState.user;
  const mining = appState.mining;
  const tasks = appState.tasks || [];
  const network = appState.network;

  if (!user) {
    target.innerHTML = '<div class="loading">Kullanıcı verisi bekleniyor.</div>';
    return;
  }

  const completedCount = tasks.filter(function (task) {
    return task.completed;
  }).length;

  const level = getLevel(user.points);

  target.innerHTML =
    '<div class="row"><span>Radar status</span><strong>' +
    (mining && mining.active ? "Aktif ✅" : "Hazır") +
    "</strong></div>" +
    '<div class="row"><span>Tamamlanan quest</span><strong>' +
    completedCount +
    " / " +
    tasks.length +
    "</strong></div>" +
    '<div class="row"><span>Level</span><strong>' +
    level +
    "</strong></div>" +
    '<div class="row"><span>Data source</span><strong>' +
    (network ? "Acki Mainnet" : "Offline") +
    "</strong></div>" +
    '<div class="row"><span>Last update</span><strong>' +
    (network ? formatTime(network.updatedAt) : "-") +
    "</strong></div>";
}
async function completeTaskFromDashboard(taskId) {
  if (!currentUserId) {
    alert("Kullanıcı ID bulunamadı.");
    return;
  }

  if (!taskId) {
    alert("Quest ID bulunamadı.");
    return;
  }

  await fetchJson("/api/tasks/" + currentUserId + "/" + taskId + "/complete", {
    method: "POST",
  });

  await reloadData();
}

async function reloadData() {
  await loadAckiNetworkStats();

  const stats = await fetchJson("/api/stats");
  appState.stats = stats;

  setText("totalUsers", stats.totalUsers);
  setText("totalPoints", stats.totalPoints);

  const leaderboard = await fetchJson("/api/leaderboard");
  renderLeaderboard(leaderboard.users);

  if (!currentUserId) {
    setText(
      "referral",
      "Telegram içinden açılmadı. Test için URL sonuna ?userId=TELEGRAM_ID ekle."
    );
    return;
  }

  const profile = await fetchJson("/api/users/" + currentUserId);
  renderProfile(profile.user);
  renderMiningState(profile.mining);

  const tasks = await fetchJson("/api/tasks/" + currentUserId);
  renderTasks(tasks.tasks);
  renderHomeTasks(tasks.tasks);
  renderHomeSummary();
}

function openTab(tabName) {
  const views = document.querySelectorAll(".view");
  const navItems = document.querySelectorAll(".nav-item");

  views.forEach(function (view) {
    view.classList.remove("active");
  });

  navItems.forEach(function (item) {
    item.classList.remove("active");
  });

  const view = document.getElementById("view-" + tabName);
  const nav = document.querySelector('.nav-item[data-tab="' + tabName + '"]');

  if (view) {
    view.classList.add("active");
  }

  if (nav) {
    nav.classList.add("active");
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function setupTabs() {
  const navItems = document.querySelectorAll(".nav-item");

  navItems.forEach(function (item) {
    item.addEventListener("click", function () {
      const tab = item.getAttribute("data-tab");
      openTab(tab);
    });
  });

  const openTabButtons = document.querySelectorAll("[data-open-tab]");

  openTabButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      openTab(button.getAttribute("data-open-tab"));
    });
  });
}

function setupRefresh() {
  const refreshBtn = document.getElementById("refreshBtn");

  if (!refreshBtn) return;

  refreshBtn.addEventListener("click", function () {
    reloadData();
  });
}

function setupExploreFilters() {
  const searchInput = document.getElementById("exploreSearch");
  const categoryBox = document.getElementById("exploreCategories");
  const cards = Array.from(document.querySelectorAll(".explore-card"));

  if (!categoryBox || !cards.length) {
    return;
  }

  let activeCategory = "all";

  function applyFilters() {
    const searchValue = searchInput
      ? searchInput.value.trim().toLowerCase()
      : "";

    cards.forEach(function (card) {
      const categories = String(card.getAttribute("data-category") || "");
      const title = String(card.getAttribute("data-title") || "").toLowerCase();
      const text = card.textContent.toLowerCase();

      const categoryMatch =
        activeCategory === "all" || categories.includes(activeCategory);

      const searchMatch =
        !searchValue ||
        title.includes(searchValue) ||
        text.includes(searchValue);

      card.hidden = !(categoryMatch && searchMatch);
    });
  }

  const buttons = categoryBox.querySelectorAll(".chip");

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      buttons.forEach(function (item) {
        item.classList.remove("active");
      });

      button.classList.add("active");
      activeCategory = button.getAttribute("data-category") || "all";

      applyFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }

  applyFilters();
}

setupTabs();
setupRefresh();
setupExploreFilters();
setupWalletLookup();

reloadData().catch(function (error) {
  console.error(error);

  document.body.innerHTML =
    '<main class="app">' +
    '<section class="panel">' +
    "<h2>Hata</h2>" +
    '<p class="loading">Veriler yüklenemedi.</p>' +
    "<code>" +
    escapeHtml(error.message) +
    "</code>" +
    "</section>" +
    "</main>";
});