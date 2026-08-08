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
};

function shellAmountToRaw(shellAmount: number): string {
  const scale = 10n ** BigInt(SHELL_DECIMALS);
  // Fix: avoid floating point drift by working in integer "milli-shell"
  // units before scaling to the full raw (9-decimal) representation.
  const milliShell = BigInt(Math.round(shellAmount * 1000));
  return ((milliShell * scale) / 1000n).toString();
}

export const PLANS: Plan[] = [
  {
    id: "standard",
    label: "Standard",
    days: 7,
    priceUsd: 4,
    priceShellRaw: shellAmountToRaw(400),
  },
  {
    id: "max",
    label: "Max",
    days: 30,
    priceUsd: 16,
    priceShellRaw: shellAmountToRaw(1600),
  },
  {
    id: "super",
    label: "Super",
    days: 90,
    priceUsd: 40,
    priceShellRaw: shellAmountToRaw(4000),
  },
];

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
