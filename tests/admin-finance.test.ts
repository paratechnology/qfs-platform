import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { approveDeposit, approveWithdrawal, createDeposit, createWithdrawal } from "../lib/services/account";
import { getAdminStats, listUsers } from "../lib/services/admin";
import { createUserDirect, ensureSetting, fundUser, resetDb } from "./helpers";

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

describe("getAdminStats — lifetime deposit/withdrawal totals", () => {
  it("sums only COMPLETED deposits and withdrawals", async () => {
    const u = await createUserDirect("Stats");

    // One approved deposit; another still pending talks about approval, not credit.
    const d1 = await createDeposit(u.id, { amountCents: 10_000, method: "Bank Transfer" });
    await createDeposit(u.id, { amountCents: 5_000, method: "Bank Transfer" });
    await approveDeposit(u.id, d1.request.id, "ok");

    let stats = await getAdminStats();
    expect(stats.totalDepositsCents).toBe(10_000);
    expect(stats.totalDeposits).toMatch(/100\.00/);
    expect(stats.totalWithdrawalsCents).toBe(0);

    // A completed withdrawal moves the withdrawal total.
    await fundUser(u.id, 20_000);
    const w = await createWithdrawal(u.id, {
      amountCents: 4_000,
      method: "Bank Transfer",
      details: "Account 123",
    });
    await approveWithdrawal(u.id, w.request.id, "ok");

    stats = await getAdminStats();
    expect(stats.totalWithdrawalsCents).toBe(4_000);
    expect(stats.totalDepositsCents).toBe(10_000);
  });
});

describe("listUsers — per-user deposit and withdrawal totals", () => {
  it("returns lifetime deposit/withdrawal cents per user", async () => {
    const a = await createUserDirect("Per A");
    const b = await createUserDirect("Per B");

    const d1 = await createDeposit(a.id, { amountCents: 30_000, method: "Bank Transfer" });
    await approveDeposit(a.id, d1.request.id, "ok");
    await createDeposit(b.id, { amountCents: 9_000, method: "Bank Transfer" }); // pending — not counted

    const { items } = await listUsers({});
    const rowA = items.find((r) => r.id === a.id);
    const rowB = items.find((r) => r.id === b.id);
    expect(rowA?.depositCents).toBe(30_000);
    expect(rowA?.withdrawalCents).toBe(0);
    expect(rowB?.depositCents).toBe(0);
  });
});

describe("createWithdrawal — seeded limits are enforced", () => {
  it("rejects amounts below min_withdrawal_cents", async () => {
    await ensureSetting("min_withdrawal_cents", "100000"); // $1,000 floor
    const u = await createUserDirect("MinLex", { balanceCents: 500_000, availableCents: 500_000 });

    await expect(
      createWithdrawal(u.id, { amountCents: 50_000, method: "Bank Transfer", details: "Acc" })
    ).rejects.toThrow(/minimum withdrawal/i);
  });

  it("enforces max_withdrawal_daily_cents across requests today", async () => {
    await ensureSetting("max_withdrawal_daily_cents", "20000"); // $200/day
    const u = await createUserDirect("CapGuy", { balanceCents: 1_000_000, availableCents: 1_000_000 });

    await createWithdrawal(u.id, { amountCents: 12_000, method: "Bank Transfer", details: "Acc" });
    await expect(
      createWithdrawal(u.id, { amountCents: 9_000, method: "Bank Transfer", details: "Acc" })
    ).rejects.toThrow(/daily withdrawal limit/i);
  });

  it("ignores limits when the settings are unset (0)", async () => {
    const u = await createUserDirect("FreeMan", { balanceCents: 1_000_000, availableCents: 1_000_000 });

    const w = await createWithdrawal(u.id, { amountCents: 500, method: "Bank Transfer", details: "Acc" });
    expect(w.created).toBe(true);

    const ok = await prisma.withdrawalRequest.findFirst({ where: { userId: u.id } });
    expect(ok?.reference).toBe(w.request.reference);
  });
});