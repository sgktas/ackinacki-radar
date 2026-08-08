const fs = require("fs");

const walletArg = String(process.argv[2] || "ackerman").trim().toLowerCase();
const limit = Number(process.argv[3] || 800);

const ENDPOINTS = [
  "https://archive.acki.live/graphql",
  "https://mainnet.ackinacki.org/graphql"
];

function normalizeAddress(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase();
}

function shortId(value) {
  if (!value) return "";
  const text = String(value);
  return text.length > 18 ? `${text.slice(0, 8)}...${text.slice(-8)}` : text;
}

function toIso(now) {
  const n = Number(now);
  if (!Number.isFinite(n)) return String(now || "");
  return new Date(n * 1000).toISOString();
}

function loadWatch(name) {
  const file = "data/mining-monitor.json";
  const raw = fs.readFileSync(file, "utf8");
  const state = JSON.parse(raw);
  const watches = Array.isArray(state.watches) ? state.watches : [];

  return watches.find((w) => {
    const candidates = [
      w.label,
      w.input,
      w.name,
      w.address,
      w.popitGameAddress
    ].filter(Boolean).map((x) => String(x).trim().toLowerCase());

    return candidates.includes(name);
  });
}

function collectAddresses(watch) {
  const set = new Set();

  for (const value of [
    watch?.address,
    watch?.input,
    watch?.popitGameAddress,
    watch?.popitGame?.address
  ]) {
    const normalized = normalizeAddress(value);
    if (normalized) set.add(normalized);
  }

  return set;
}

async function gql(endpoint, query, variables) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${endpoint}?_ts=${Date.now()}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });

    const data = await res.json();

    if (!res.ok || data.errors) {
      throw new Error(data.errors?.[0]?.message || `HTTP ${res.status}`);
    }

    return data.data;
  } finally {
    clearTimeout(timeout);
  }
}

const query = `
query GetTransactions($limit: Int!) {
  blockchain {
    transactions(last: $limit) {
      nodes {
        id
        now
        account_addr
        balance_delta(format: DEC)
        in_message {
          id
          src
          dst
          value(format: DEC)
          value_other { currency value(format: DEC) }
          msg_type_name
        }
        out_messages {
          id
          src
          dst
          value(format: DEC)
          value_other { currency value(format: DEC) }
          msg_type_name
        }
      }
    }
  }
}
`;

function extractEvents(nodes, addresses) {
  const allEvents = [];
  const matchedEvents = [];

  for (const tx of nodes || []) {
    const messages = [];

    if (tx.in_message) {
      messages.push({ direction: "in", ...tx.in_message });
    }

    for (const out of tx.out_messages || []) {
      messages.push({ direction: "out", ...out });
    }

    for (const msg of messages) {
      const msgAddresses = [
        normalizeAddress(tx.account_addr),
        normalizeAddress(msg.src),
        normalizeAddress(msg.dst)
      ].filter(Boolean);

      const matched = msgAddresses.some((addr) => addresses.has(addr));

      for (const item of msg.value_other || []) {
        const amount = Number(item.value);

        if (!Number.isFinite(amount) || amount <= 0) continue;

        const event = {
          txId: tx.id,
          msgId: msg.id,
          now: tx.now,
          iso: toIso(tx.now),
          account: tx.account_addr,
          direction: msg.direction,
          src: msg.src,
          dst: msg.dst,
          amount,
          amountText: item.value,
          currency: item.currency,
          matched
        };

        allEvents.push(event);
        if (matched) matchedEvents.push(event);
      }
    }
  }

  return { allEvents, matchedEvents };
}

function printEvents(title, events, max = 80) {
  console.log(`\n=== ${title} (${events.length}) ===`);

  for (const e of events.slice(0, max)) {
    console.log([
      e.iso,
      `amount=${e.amountText}`,
      `currency=${e.currency}`,
      `tx=${shortId(e.txId)}`,
      `msg=${shortId(e.msgId)}`,
      `src=${shortId(e.src)}`,
      `dst=${shortId(e.dst)}`
    ].join(" | "));
  }
}

(async () => {
  const watch = loadWatch(walletArg);

  if (!watch) {
    console.error(`Watch bulunamadı: ${walletArg}`);
    process.exit(1);
  }

  const addresses = collectAddresses(watch);

  console.log("Probe wallet:", walletArg);
  console.log("Watch:", JSON.stringify({
    label: watch.label,
    input: watch.input,
    address: watch.address,
    popitGameAddress: watch.popitGameAddress
  }, null, 2));

  console.log("Filter addresses:");
  console.log([...addresses].join("\n"));

  for (const endpoint of ENDPOINTS) {
    console.log(`\n\n### Endpoint: ${endpoint}`);

    try {
      const data = await gql(endpoint, query, { limit });
      const nodes = data.blockchain?.transactions?.nodes || [];
      console.log(`Fetched transactions: ${nodes.length}`);

      const { allEvents, matchedEvents } = extractEvents(nodes, addresses);

      printEvents("MATCHED VALUE_OTHER EVENTS", matchedEvents, 120);

      if (matchedEvents.length === 0) {
        printEvents("GLOBAL VALUE_OTHER SAMPLE", allEvents, 60);
      }
    } catch (error) {
      console.error(`Endpoint failed: ${endpoint}`);
      console.error(error.message || error);
    }
  }
})();
