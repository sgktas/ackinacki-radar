// Arc / USDC payments.
//
// Third payment rail, alongside Telegram Stars and TON/USDT. What it buys us
// over the other two is that settlement stops being a guess:
//
//   SHELL rail : matched by exact amount, with a unique fractional offset per
//                invoice. Breaks if a wallet rounds, and two invoices can
//                collide.
//   TON rail   : matched by a code in the transfer comment. Better, but the
//                poll reads a fixed window of recent events — a long enough
//                outage pushes a payment behind the cursor and it is never
//                credited. Silently.
//   Arc rail   : the invoice id is an argument of the payment call itself.
//                The chain records which invoice was paid; nothing is inferred.
//
// The contract is InvoiceRegistry, deployed and source-verified on Arc Testnet.
// Its source and a standalone SDK live at https://github.com/sgktas/arcpay —
// this file is the bot's own thin client, written against the JSON-RPC directly
// so the bot gains no new dependency (the same choice tonPayments.ts makes with
// tonapi).
//
// Verified against Arc Testnet on 2026-08-30. Three things bit us there and are
// handled below; all three passed local tests and only appeared on chain:
//
//  1. USDC has two decimal precisions. The NATIVE balance — what `msg.value`
//     and a payment amount speak — has 18. The USDC ERC-20 interface at
//     0x3600…0000 has 6. One balance, two views. Mixing them misprices by 10^12.
//  2. `eth_newFilter` answers "internal error" on Arc. Log watching must poll
//     `eth_getLogs` over block ranges; filters are not available.
//  3. Circle's primary RPC rate limits sustained `eth_getLogs`. Measured over
//     twelve back-to-back calls: blockdaemon 12/12, drpc 12/12, quicknode 4/12,
//     rpc.testnet.arc.io 0/12. Hence the endpoint order below, and the failover.

export const ARC_CHAIN_ID = 5042002;

// Native USDC on Arc. NOT 6 — see note 1 above.
export const USDC_NATIVE_DECIMALS = 18;

// Ordered by measured tolerance for log polling, best first. Circle's primary
// endpoint is last: fine for a one-off read, useless for a payment watcher.
export const ARC_RPC_URLS = [
  "https://rpc.blockdaemon.testnet.arc.io",
  "https://rpc.drpc.testnet.arc.io",
  "https://rpc.quicknode.testnet.arc.io",
  "https://rpc.testnet.arc.io",
] as const;

// Endpoints usable for eth_getLogs over a block range. Quicknode is absent on
// purpose: it answers HTTP 413 above roughly a thousand blocks, which is under
// one tick's worth of chain on Arc.
export const ARC_LOG_RPC_URLS = [
  "https://rpc.blockdaemon.testnet.arc.io",
  "https://rpc.drpc.testnet.arc.io",
  "https://rpc.testnet.arc.io",
] as const;

// Blocks per eth_getLogs call. Measured maximums on 2026-08-30: blockdaemon
// >=100k, drpc >=10k, Circle primary >=10k, quicknode >=1k. Ten thousand is the
// largest span all three log endpoints accept.
//
// For scale: Arc produces roughly 600,000 blocks a day, so a wide range is not
// an edge case here the way it is on a twelve-second chain. A range that looks
// modest in days is enormous in blocks.
export const ARC_MAX_BLOCK_SPAN = 10_000;

// keccak256("Paid(address,bytes32,address,uint256,uint256)") — taken from a
// real log emitted by the deployed contract, not computed by hand.
export const PAID_TOPIC =
  "0x10fa550e6cee394dcb546ce24d453ae92dabb7bcc15a4c80b6cd40394f11d51f";

export type ArcIncomingPayment = {
  // Invoice code as the payer sent it, e.g. "ARV49ZGF". Null when the bytes32
  // did not decode to a code this bot would have issued.
  code: string | null;
  invoiceId: string;
  payer: string;
  amountRaw: string;
  // Cumulative total for this invoice after this payment, straight from the
  // contract. Partial payments add up rather than being rejected.
  totalPaidRaw: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
};

// USD price -> raw native units. Integer cents first, so 7.50 never becomes
// 7.4999999. Mirrors usdtAmountToRaw in tonPayments.ts.
export function usdToUsdcRaw(priceUsd: number): string {
  const scale = 10n ** BigInt(USDC_NATIVE_DECIMALS);
  const cents = BigInt(Math.round(priceUsd * 100));
  return ((cents * scale) / 100n).toString();
}

export function formatUsdcAmount(raw: string): string {
  const scale = 10n ** BigInt(USDC_NATIVE_DECIMALS);
  const value = BigInt(raw || "0");
  const whole = value / scale;
  const frac = value % scale;
  const fracStr = frac.toString().padStart(USDC_NATIVE_DECIMALS, "0").slice(0, 2);
  return `${whole}.${fracStr}`;
}

// The invoice code goes on chain as bytes32 — the raw ASCII, right-padded,
// NOT a hash.
//
// Hashing would have meant carrying a keccak implementation for no gain, and
// would have made every payment opaque on the explorer. This way the code is
// legible in the transaction on Arcscan, and a log can be decoded back to a
// code without consulting our database — which matters when reconciling a
// payment whose invoice record is missing.
export function codeToInvoiceId(code: string): string {
  const normalized = code.trim().toUpperCase();

  if (!/^[A-Z0-9]{1,32}$/.test(normalized)) {
    throw new Error("ARC_INVALID_INVOICE_CODE");
  }

  let hex = "";
  for (let i = 0; i < normalized.length; i += 1) {
    hex += normalized.charCodeAt(i).toString(16).padStart(2, "0");
  }

  return `0x${hex.padEnd(64, "0")}`;
}

// Inverse of codeToInvoiceId. Returns null for anything that is not printable
// ASCII in the invoice alphabet — a stranger can call pay() with any bytes32,
// and that must not become text we render anywhere.
export function invoiceIdToCode(invoiceId: string): string | null {
  const hex = invoiceId.startsWith("0x") ? invoiceId.slice(2) : invoiceId;

  if (hex.length !== 64) return null;

  let code = "";

  for (let i = 0; i < 64; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);

    if (Number.isNaN(byte)) return null;
    if (byte === 0) break; // padding reached

    // A-Z and 0-9 only. Anything else means this was not one of our codes.
    const isDigit = byte >= 0x30 && byte <= 0x39;
    const isUpper = byte >= 0x41 && byte <= 0x5a;

    if (!isDigit && !isUpper) return null;

    code += String.fromCharCode(byte);
  }

  return code.length ? code : null;
}

function normalizeAddress(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

// A 32-byte topic carries a 20-byte address in its low bytes.
function topicToAddress(topic: string): string {
  const hex = topic.startsWith("0x") ? topic.slice(2) : topic;
  return `0x${hex.slice(-40)}`.toLowerCase();
}

function addressToTopic(address: string): string {
  const hex = normalizeAddress(address).replace(/^0x/, "");
  return `0x${hex.padStart(64, "0")}`;
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`);
}

// One JSON-RPC call, walking the endpoint list until one answers. Arc's
// endpoints rate limit independently, so a 429 on one is not a chain problem —
// it is a reason to ask the next one.
async function arcRpc(
  method: string,
  params: unknown[],
  rpcUrls: readonly string[] = ARC_RPC_URLS,
): Promise<any> {
  const failures: string[] = [];

  for (const url of rpcUrls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        failures.push(`${url}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (data?.error) {
        failures.push(`${url}: ${data.error?.message || "rpc error"}`);
        continue;
      }

      return data?.result;
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Every endpoint failed. Surfacing all of them matters: "rate limited on all
  // four" and "the chain is down" need different responses from us.
  throw new Error(`ARC_RPC_ALL_FAILED: ${failures.join(" | ")}`);
}

// The chain the endpoint is actually serving. Checked before crediting
// anything: testnet USDC is free from a faucet, so crediting a testnet payment
// as though it were mainnet would give subscriptions away.
export async function fetchArcChainId(
  rpcUrls?: readonly string[],
): Promise<number> {
  const result = await arcRpc("eth_chainId", [], rpcUrls);
  return Number(hexToBigInt(String(result)));
}

export async function fetchArcBlockNumber(
  rpcUrls?: readonly string[],
): Promise<number> {
  const result = await arcRpc("eth_blockNumber", [], rpcUrls);
  return Number(hexToBigInt(String(result)));
}

// Payments to `merchant` in [fromBlock, toBlock], oldest first.
//
// Filtered server-side by the indexed merchant topic, so another bot's payments
// through the same registry never reach us.
//
// The range is walked in ARC_MAX_BLOCK_SPAN chunks because width, not age, is
// the binding constraint. A single 1.26M-block request was refused by all four
// endpoints for four different reasons — blockdaemon "pruned history
// unavailable", drpc HTTP 400, quicknode HTTP 413, Circle primary "requested
// range too large" — while a 1.6k-block window over the same two-day-old
// stretch answered fine once chunked.
//
// Still, do not treat log replay as the recovery mechanism: one endpoint does
// claim to prune, and none of them promise retention. Contract state is the
// durable record — fetchArcAmountPaid answers for an invoice regardless of how
// old it is, and is bounded by the number of pending invoices rather than by
// how many blocks the chain has produced (roughly 600,000 a day here).
export async function fetchArcPayments(options: {
  registryAddress: string;
  merchantAddress: string;
  fromBlock: number;
  toBlock?: number;
  rpcUrls?: readonly string[];
  maxBlockSpan?: number;
}): Promise<ArcIncomingPayment[]> {
  const { registryAddress, merchantAddress, fromBlock } = options;
  const rpcUrls = options.rpcUrls ?? ARC_LOG_RPC_URLS;
  const span = Math.max(1, options.maxBlockSpan ?? ARC_MAX_BLOCK_SPAN);
  const toBlock =
    options.toBlock ?? (await fetchArcBlockNumber(ARC_RPC_URLS));

  const logs: any[] = [];

  for (let start = fromBlock; start <= toBlock; start += span) {
    const end = Math.min(start + span - 1, toBlock);

    const chunk = await arcRpc(
      "eth_getLogs",
      [
        {
          address: registryAddress,
          topics: [PAID_TOPIC, addressToTopic(merchantAddress)],
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
        },
      ],
      rpcUrls,
    );

    if (Array.isArray(chunk)) logs.push(...chunk);
  }

  const payments: ArcIncomingPayment[] = [];

  for (const log of logs) {
    // Reorg protection is not needed — Arc has deterministic sub-second
    // finality — but a malformed log still must not throw mid-tick.
    if (log?.removed) continue;

    const topics = Array.isArray(log?.topics) ? log.topics : [];

    // [signature, merchant, invoiceId, payer]
    if (topics.length < 4) continue;

    const invoiceId = String(topics[2] ?? "");
    const payer = topicToAddress(String(topics[3] ?? ""));

    // data = abi.encode(amount, totalPaid): two 32-byte words.
    const data = String(log?.data ?? "").replace(/^0x/, "");

    if (data.length < 128) continue;

    let amountRaw: string;
    let totalPaidRaw: string;

    try {
      amountRaw = hexToBigInt(data.slice(0, 64)).toString();
      totalPaidRaw = hexToBigInt(data.slice(64, 128)).toString();
    } catch {
      continue;
    }

    payments.push({
      code: invoiceIdToCode(invoiceId),
      invoiceId,
      payer,
      amountRaw,
      totalPaidRaw,
      blockNumber: Number(hexToBigInt(String(log?.blockNumber ?? "0x0"))),
      txHash: String(log?.transactionHash ?? ""),
      logIndex: Number(hexToBigInt(String(log?.logIndex ?? "0x0"))),
    });
  }

  return payments.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
  );
}

// Contract state, which is authoritative in a way a log subscription is not.
// Call this before granting anything: logs can be missed, replayed, or served
// by an endpoint that is behind, whereas this is the registry's own tally.
export async function fetchArcAmountPaid(options: {
  registryAddress: string;
  merchantAddress: string;
  invoiceId: string;
  rpcUrls?: readonly string[];
}): Promise<bigint> {
  // amountPaid(address,bytes32) — selector then the two 32-byte arguments.
  // Selector from `cast sig`, not written by hand: a wrong one does not throw,
  // it returns empty data that reads as a zero balance, so every payment would
  // look unpaid.
  const selector = "0x70a76464";
  const merchantArg = addressToTopic(options.merchantAddress).slice(2);
  const invoiceArg = options.invoiceId.replace(/^0x/, "").padStart(64, "0");

  const result = await arcRpc(
    "eth_call",
    [
      {
        to: options.registryAddress,
        data: `${selector}${merchantArg}${invoiceArg}`,
      },
      "latest",
    ],
    options.rpcUrls,
  );

  const hex = String(result ?? "0x0");

  return hex === "0x" ? 0n : hexToBigInt(hex);
}
