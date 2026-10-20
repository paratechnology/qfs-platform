import { describe, expect, it } from "vitest";
import {
  centsToDollars,
  dollarsToCents,
  formatMoney,
  monthlyRoiCents,
  monthsBetween,
  roundHalfUp,
} from "../lib/money";

describe("money helpers — integer cents only", () => {
  it("rounds dollar amounts to exact cents", () => {
    expect(dollarsToCents(100)).toBe(10000);
    expect(dollarsToCents(50.5)).toBe(5050);
    expect(dollarsToCents(0.01)).toBe(1);
    expect(dollarsToCents(19.99)).toBe(1999);
    // FP-safe: 0.1 + 0.2 == 30 cents
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });

  it("rejects invalid amounts", () => {
    expect(() => dollarsToCents(NaN)).toThrow();
    expect(() => dollarsToCents(-5)).toThrow();
    expect(() => dollarsToCents(Infinity)).toThrow();
  });

  it("formats cents the way the UI expects", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(-50)).toBe("-$0.50");
  });

  it("rounds half-up for ROI splits", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.4)).toBe(1);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(centsToDollars(5050)).toBe(50.5);
  });
});

describe("monthly ROI rounding", () => {
  it("computes 5% of $10,000 as exactly $500.00", () => {
    expect(monthlyRoiCents(1_000_000, 500)).toBe(50_000);
  });

  it("rounds fractional cents half-up, never truncating", () => {
    // $10,000 principal at 3.5% (350 bps) = 35,000 cents — exact.
    expect(monthlyRoiCents(1_000_000, 350)).toBe(35_000);
    // $105.00 at 7.5% = 787.5 cents → rounds to 788 (never 787.4-ish drift).
    expect(monthlyRoiCents(10_500, 750)).toBe(788);
    // Small principal at low bps still yields >= 1 cent when warranted.
    expect(monthlyRoiCents(100, 100)).toBe(1);
    expect(monthlyRoiCents(50, 100)).toBe(1);
    // 30c at 1% = 0.3c → rounds half-up to 0 (below half-a-cent threshold).
    expect(monthlyRoiCents(30, 100)).toBe(0);
    // 51c at 1% = 0.51c → rounds to 1.
    expect(monthlyRoiCents(51, 100)).toBe(1);
  });

  it("is deterministic and commutative with big numbers", () => {
    const a = monthlyRoiCents(123_456_789, 137);
    const b = monthlyRoiCents(123_456_789, 137);
    expect(a).toBe(b);
    expect(a).toBe(Math.floor((123_456_789 * 137) / 10000 + 0.5));
  });
});

describe("monthsBetween — month-index based, deterministic", () => {
  it("counts elapsed months from the same month as 0", () => {
    const start = new Date(Date.UTC(2026, 0, 15));
    const sameMonth = new Date(Date.UTC(2026, 0, 28));
    expect(monthsBetween(start, sameMonth)).toBe(0);
  });

  it("counts full month-index boundaries", () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    expect(monthsBetween(start, new Date(Date.UTC(2026, 1, 1)))).toBe(1);
    expect(monthsBetween(start, new Date(Date.UTC(2026, 5, 15)))).toBe(5);
    expect(monthsBetween(start, new Date(Date.UTC(2027, 0, 1)))).toBe(12);
  });

  it("is negative when b precedes a", () => {
    expect(monthsBetween(new Date(Date.UTC(2026, 5, 1)), new Date(Date.UTC(2026, 2, 1)))).toBe(-3);
  });
});