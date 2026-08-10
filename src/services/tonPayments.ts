// TON / USDT payments.
//
// Replaces the SHELL rail for real revenue: SHELL is the chain's gas token and
// collecting it does not pay a hosting bill, whereas USDT on TON is a stable
// unit that the audience (Acki Nacki miners, all of whom already run wallets)
// can send today.  The SHELL code in bot.ts is left intact but stays switched
// off — see PAYMENTS_CHECK_ENABLED.
//
// The API contract below was verified against live tonapi.io responses rather
// than written from documentation, because the parser depends on exact field
// names:
//
//   event          : event_id, timestamp, lt, in_progress, actions
//   JettonTransfer : sender, recipient, senders_wallet, recipients_wallet,
//                    amount, comment, jetton
//
// SECURITY: anyone can mint a jetton called "USDT". Matching on the symbol
// would let a worthless look-alike buy a subscription, so every transfer is
// checked against the jetton MASTER ADDRESS below, which was confirmed via
// tonapi (name "Tether USD", verification "whitelist", 3.3M holders).
export const USDT_JETTON_MASTER =
  "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";

// USDT on TON uses 6 decimals, NOT the 9 that SHELL uses. Mixing the two up
// would misprice every plan by 1000x.
export const USDT_DECIMALS = 6;

const TONAPI_BASE = "https://tonapi.io/v2";

// Native TON uses 9 decimals (nanotons), USDT uses 6. Every amount below
// carries its currency so the two can never be compared directly.
export const TON_DECIMALS = 9;

export type PayCurrency = "usdt" | "ton";

export type TonIncomingTransfer = {
  eventId: string;
  lt: number;
  timestamp: number;
  currency: PayCurrency;
  amountRaw: string;
  comment: string | null;
  senderAddress: string | null;
};

export function usdtAmountToRaw(amount: number): string {
  const scale = 10n ** BigInt(USDT_DECIMALS);
  // Work in integer cents first so 4.10 does not become 4.099999.
  const cents = BigInt(Math.round(amount * 100));
  return ((cents * scale) / 100n).toString();
}

export function formatUsdtAmount(raw: string): string {
  const scale = 10n ** BigInt(USDT_DECIMALS);
  const value = BigInt(raw);
  const whole = value / scale;
  const frac = value % scale;
  const fracStr = frac.toString().padStart(USDT_DECIMALS, "0").slice(0, 2);
  return `${whole}.${fracStr}`;
}

export function formatTonAmount(raw: string): string {
  const scale = 10n ** BigInt(TON_DECIMALS);
  const value = BigInt(raw);
  const whole = value / scale;
  const frac = value % scale;
  const fracStr = frac.toString().padStart(TON_DECIMALS, "0").slice(0, 3);
  return `${whole}.${fracStr}`;
}

export function formatPayAmount(raw: string, currency: PayCurrency): string {
  return currency === "ton" ? formatTonAmount(raw) : formatUsdtAmount(raw);
}

// TON/USD from the same host the transfer polling already uses, so accepting
// TON adds an endpoint rather than a dependency.
//
// The rate is only ever used to fix an invoice's TON amount at creation time;
// that amount is then locked for the invoice's lifetime, so a price move
// during the payment window costs nothing.
export async function fetchTonUsdRate(apiKey?: string): Promise<number> {
  const data = await tonapiGet("/rates?tokens=ton&currencies=usd", apiKey);
  const rate = Number(data?.rates?.TON?.prices?.USD);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("TON_RATE_UNAVAILABLE");
  }

  return rate;
}

// USD price -> nanotons, rounded UP to whole milli-TON. Rounding up rather
// than to nearest keeps a rounding step from quietly eating margin, and a
// 3-decimal amount is easier for a payer to copy than 9 significant digits.
export function usdToTonRaw(priceUsd: number, tonUsdRate: number): string {
  const milliTon = BigInt(Math.ceil((priceUsd / tonUsdRate) * 1000));
  const scale = 10n ** BigInt(TON_DECIMALS - 3);
  return (milliTon * scale).toString();
}

// Invoice codes go in the transfer's comment field. TON delivers comments
// reliably, which is why this rail does not need the SHELL rail's trick of
// making each invoice a slightly different amount.
//
// The alphabet deliberately omits 0/O and 1/I/L: users retype these by hand
// from a phone, and a single misread character means the payment arrives with
// no matching invoice.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function buildInvoiceCode(): string {
  let code = "";

  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }

  return `AR${code}`;
}

// Comments arrive with whatever spacing and case the user's wallet passed
// through, and some wallets prepend their own text.
export function extractInvoiceCode(comment: string | null): string | null {
  if (!comment) return null;

  const match = comment.toUpperCase().match(/AR[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}/);

  return match ? match[0] : null;
}

function normalizeAddress(address: unknown): string {
  return String(address || "").trim().toLowerCase();
}

async function tonapiGet(path: string, apiKey?: string): Promise<any> {
  // Built conditionally rather than with `headers: undefined`: the project
  // compiles with exactOptionalPropertyTypes, so an explicit undefined is a
  // type error, not a no-op.
  const init: RequestInit = { signal: AbortSignal.timeout(20000) };

  if (apiKey) {
    init.headers = { Authorization: `Bearer ${apiKey}` };
  }

  const response = await fetch(`${TONAPI_BASE}${path}`, init);

  if (!response.ok) {
    throw new Error(`TONAPI_${response.status}`);
  }

  return response.json();
}

// tonapi reports addresses in raw `0:<hex>` form, while the receiving address
// is configured in the friendly `UQ…` form the wallet app shows. Resolve once
// and cache, so every transfer can be compared against a raw address.
let cachedRawAddress: { friendly: string; raw: string } | null = null;

export async function resolveRawAddress(
  friendlyAddress: string,
  apiKey?: string,
): Promise<string> {
  if (cachedRawAddress && cachedRawAddress.friendly === friendlyAddress) {
    return cachedRawAddress.raw;
  }

  const data = await tonapiGet(
    `/accounts/${encodeURIComponent(friendlyAddress)}`,
    apiKey,
  );
  const raw = normalizeAddress(data?.address);

  if (!raw) {
    throw new Error("TON_ADDRESS_UNRESOLVED");
  }

  cachedRawAddress = { friendly: friendlyAddress, raw };

  return raw;
}

// Incoming payments newer than `sinceLt`, oldest first — both native TON and
// USDT jetton transfers.
//
// Reads the generic /events feed rather than the per-jetton history endpoint,
// so one request and one cursor cover both currencies. The feed also carries
// SmartContractExec and this account's OUTGOING transfers, so the recipient
// check is not optional: without it, spending from the wallet would read as
// income.
export async function fetchIncomingPayments(options: {
  friendlyAddress: string;
  sinceLt: number;
  apiKey?: string;
  limit?: number;
}): Promise<TonIncomingTransfer[]> {
  const { friendlyAddress, sinceLt, apiKey } = options;
  const limit = Math.max(1, Math.min(100, options.limit || 50));
  const rawAddress = await resolveRawAddress(friendlyAddress, apiKey);

  const data = await tonapiGet(
    `/accounts/${encodeURIComponent(friendlyAddress)}/events?limit=${limit}`,
    apiKey,
  );

  const events = Array.isArray(data?.events) ? data.events : [];
  const transfers: TonIncomingTransfer[] = [];

  for (const event of events) {
    // Still settling — its amount or status can change, so leave it for a
    // later poll rather than crediting a subscription off it.
    if (event?.in_progress) continue;

    const lt = Number(event?.lt || 0);

    if (!Number.isFinite(lt) || lt <= sinceLt) continue;

    for (const action of Array.isArray(event?.actions) ? event.actions : []) {
      if (action?.status !== "ok") continue;

      const isJetton = action.type === "JettonTransfer";
      const isTon = action.type === "TonTransfer";

      if (!isJetton && !isTon) continue;

      const transfer = isJetton ? action.JettonTransfer : action.TonTransfer;

      if (!transfer) continue;

      // A jetton called "USDT" can be minted by anyone — the master address
      // is what makes it the real one.
      if (
        isJetton &&
        normalizeAddress(transfer?.jetton?.address) !== USDT_JETTON_MASTER
      ) {
        continue;
      }

      if (normalizeAddress(transfer?.recipient?.address) !== rawAddress) continue;

      transfers.push({
        eventId: String(event.event_id || ""),
        lt,
        timestamp: Number(event.timestamp || 0),
        currency: isJetton ? "usdt" : "ton",
        amountRaw: String(transfer.amount ?? "0"),
        comment: transfer.comment ? String(transfer.comment) : null,
        senderAddress: transfer?.sender?.address
          ? String(transfer.sender.address)
          : null,
      });
    }
  }

  return transfers.sort((a, b) => a.lt - b.lt);
}
