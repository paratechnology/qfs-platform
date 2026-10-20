/* Money helpers — all amounts are integer minor units (cents). No floats. */

export function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid amount");
  return Math.round(amount * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Round half-up (banker-friendly display for ROI splits). */
export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

/** Monthly ROI in cents for a principal given basis points (half-up). */
export function monthlyRoiCents(principalCents: number, bps: number): number {
  return roundHalfUp((principalCents * bps) / 10000);
}

/** Approx. full months between two dates (month-index based, deterministic). */
export function monthsBetween(a: Date, b: Date): number {
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth())
  );
}