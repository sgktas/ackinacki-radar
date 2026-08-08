const fs = require("fs");

const walletArg = String(process.argv[2] || "ackerman").trim().toLowerCase();
const limit = Number(process.argv[3] || 120);
const ENDPOINT = "https://mainnet.ackinacki.org/graphql";

function loadWatch(name) {
  const raw = fs.readFileSync("data/mining-monitor.json", "utf8");
  const state = JSON.parse(raw);
  const watches = Array.isArray(state.watches) ? state.watches : [];

  return watches.find((w) => {
    return [w.label, w.input, w.name, w.address, w.popitGameAddress]
      .filter(Boolean)
      .map((x) => String(x).trim().toLowerCase())
      .includes(name);
  });
}

function parseAccount(value) {
  const raw = String(value || "").trim().toLowerCase();

  const composite = raw.match(/^([a-f0-9]{64})::([a-f0-9]{64})$/i);
  if (composite) {
    return {
      dappId: composite[1],
      accountId: composite[2]
    };
  }

  const full = raw.match(/^(-?\d+):([a-f0-9]{64})$/i);
  if (full) {
    return {
      dappId: full[2],
      accountId: full[2]
    };
  }

  const plain = raw.match(/^([a-f0-9]{64})$/i);
  if (plain) {
    return {
      dappId: plain[1],
      accountId: plain[1]
    };
  }

  throw new Error(`Invalid account format: ${value}`);
}

function toIso(now) {
  const n = Number(now);
  if (!Number.isFinite(n)) return String(now || "");
  return new Date(n * 1000).toISOString();
}

function short(value) {
  if (!value) return "";
  const text = String(value);
  return text.length > 22 ? `${text.slice(0, 10)}...${text.slice(-10)}` : text;
}

async function gql(query, variables) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(`${ENDPOINT}?_ts=${Date.now()}`, {
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
query AccountTransactions($accountId: String!, $dappId: String!, $limit: Int!) {
  blockchain {
    account(account_id: $accountId, dapp_id: $dappId) {
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
}
`;

function inspectTx(nodes) {
  let valueOtherCount = 0;
  let printed = 0;

  for (const tx of nodes || []) {
    const messages = [];

    if (tx.in_message) messages.push({ dir: "in", ...tx.in_message });
    for (const out of tx.out_messages || []) messages.push({ dir: "out", ...out });

    const interesting = [];

    for (const msg of messages) {
      if (Number(msg.value || 0) > 0) {
        interesting.push({
          type: "value",
          dir: msg.dir,
          amount: msg.value,
          src: msg.src,
          dst: msg.dst,
          msgId: msg.id
        });
      }

      for (const vo of msg.value_other || []) {
        valueOtherCount += 1;
        interesting.push({
          type: "value_other",
          dir: msg.dir,
          amount: vo.value,
          currency: vo.currency,
          src: msg.src,
          dst: msg.dst,
          msgId: msg.id
        });
      }
    }

    if (interesting.length > 0) {
      printed += 1;
      console.log(`\nTX ${short(tx.id)} | ${toIso(tx.now)} | balance_delta=${tx.balance_delta}`);

      for (const item of interesting) {
        console.log(
          [
            `  ${item.type}`,
            `dir=${item.dir}`,
            `amount=${item.amount}`,
            item.currency ? `currency=${item.currency}` : "",
            `msg=${short(item.msgId)}`,
            `src=${short(item.src)}`,
            `dst=${short(item.dst)}`
          ].filter(Boolean).join(" | ")
        );
      }
    }
  }

  console.log(`\nprinted_tx=${printed}`);
  console.log(`value_other_count=${valueOtherCount}`);
}

(async () => {
  const watch = loadWatch(walletArg);

  if (!watch) {
    console.error(`Watch bulunamadı: ${walletArg}`);
    process.exit(1);
  }

  const targets = [
    ["wallet", watch.address],
    ["popitGame", watch.popitGameAddress]
  ].filter(([, address]) => address);

  console.log("Probe:", walletArg);
  console.log(JSON.stringify({
    label: watch.label,
    input: watch.input,
    address: watch.address,
    popitGameAddress: watch.popitGameAddress
  }, null, 2));

  for (const [name, address] of targets) {
    console.log(`\n\n### ACCOUNT ${name}: ${address}`);

    try {
      const parsed = parseAccount(address);
      console.log("account_id:", parsed.accountId);
      console.log("dapp_id:", parsed.dappId);

      const data = await gql(query, {
        accountId: parsed.accountId,
        dappId: parsed.dappId,
        limit
      });

      const nodes = data.blockchain?.account?.transactions?.nodes || [];
      console.log(`transactions=${nodes.length}`);
      inspectTx(nodes);
    } catch (error) {
      console.error(`FAILED ${name}: ${error.message || error}`);
    }
  }
})();
