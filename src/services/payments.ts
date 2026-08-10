// Payments: SHELL-denominated subscription plans for the cloud mining
// feature. Pricing uses SHELL (Acki Nacki's fixed-price native/gas token)
// rather than NACKL (the volatile mining-reward token), since a stable unit
// is what makes a subscription price make sense over time.
//
// Conversion reference used for these prices: 100 SHELL ~= 1 USDC (seen on
// a comparable service's top-up screen). If that peg is ever confirmed to
// have moved, these SHELL amounts should be revisited — they are NOT fetched
// from a live price feed.

export const SHELL_DECIMALS = 9;

export type PlanId = "standard" | "max" | "super";

export type Plan = {
  id: PlanId;
  label: string;
  days: number;
  priceUsd: number;
  priceShellRaw: string;
  // Fixes the Stars price instead of deriving it from priceUsd. Only the test
  // plan uses it — a real plan's star price must follow its USD price.
  starsOverride?: number;
};

function shellAmountToRaw(shellAmount: number): string {
  const scale = 10n ** BigInt(SHELL_DECIMALS);
  // Fix: avoid floating point drift by working in integer "milli-shell"
  // units before scaling to the full raw (9-decimal) representation.
  const milliShell = BigInt(Math.round(shellAmount * 1000));
  return ((milliShell * scale) / 1000n).toString();
}

// Telegram Stars price. Anchored to 66 ⭐ per USD, the rate a comparable Acki
// Nacki mining bot publishes ("1 USDT = 66 ⭐ / 10 USDT = 666 ⭐") — observed
// market practice beats guessing at Telegram's own conversion.
export const STARS_PER_USD = 66;

function starsForUsd(priceUsd: number): number {
  return Math.round(priceUsd * STARS_PER_USD);
}

// Repriced 2026-08-10 to match that competitor exactly (14/30/90 days at
// 5/10/25 USDT). The old 7/30/90 at 4/16/40 was well above them. We compete on
// what they do not offer — a 3-day free trial and the web dashboard — rather
// than on price, which is a race we would rather not run.
export const PLANS: Plan[] = [
  {
    id: "standard",
    label: "Standard",
    days: 14,
    priceUsd: 5,
    priceShellRaw: shellAmountToRaw(500),
  },
  {
    id: "max",
    label: "Max",
    days: 30,
    priceUsd: 10,
    priceShellRaw: shellAmountToRaw(1000),
  },
  {
    id: "super",
    label: "Super",
    days: 90,
    priceUsd: 25,
    priceShellRaw: shellAmountToRaw(2500),
  },
];

export function getPlanStars(plan: Plan): number {
  return plan.starsOverride ?? starsForUsd(plan.priceUsd);
}

// A 1-star, 1-day plan for exercising the payment path end to end without
// spending the price of a real subscription. Kept OUT of `PLANS` so it can
// never appear in a public listing, and only redeemable by an admin — see the
// /pay handler. Delete once Stars has been proven in production.
export const TEST_PLAN: Plan = {
  id: "test" as PlanId,
  label: "Test",
  days: 1,
  priceUsd: 0.02,
  priceShellRaw: shellAmountToRaw(2),
  starsOverride: 1,
};

// One free trial per user, ever. Long enough to see several full mining cycles
// (a cycle is ~24h), which is what makes the service judgeable at all.
export const TRIAL_DAYS = 3;

export function getPlanById(planId: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === planId);
}

// Fix: since we're matching incoming payments by exact amount rather than
// a memo/comment field (not confirmed to be reliably supported on every
// transfer path), each invoice gets a small unique fractional offset added
// to the plan's base price. Two people buying the "Max" plan at the same
// time will have distinguishable exact amounts to watch for.
export function buildInvoiceAmountRaw(planPriceRaw: string, offsetIndex: number): string {
  // Offset range: 0.001 - 0.999 SHELL, keyed off offsetIndex so repeated
  // calls for the same invoice are stable, and different invoices are
  // very unlikely to collide.
  const offsetMilliShell = BigInt(1 + (offsetIndex % 999));
  const scale = 10n ** BigInt(SHELL_DECIMALS - 3); // milli-shell -> raw
  const offsetRaw = offsetMilliShell * scale;
  return (BigInt(planPriceRaw) + offsetRaw).toString();
}
