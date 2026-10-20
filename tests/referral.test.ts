import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { createInvestment } from "../lib/services/account";
import { ensureSetting, createPlan, createUser, createUserDirect, fundUser, resetDb } from "./helpers";

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  await ensureSetting("referral_rate_bps", "500");
});

describe("referral bonuses — exact, once per referred investment", () => {
  it("pays the referrer 5% (500 bps) of the referred investment, in cents", async () => {
    const referrer = await createUser("Maa Ama", "maa@test.qfs");
    const referred = await createUser("Kofi Mensah", "kofi@test.qfs", { referredBy: referrer.id });
    await fundUser(referred.id, 2_000_000);
    const plan = await createPlan({ name: "Gold", minAmountCents: 5_000, monthlyRoiBps: 300, termMonths: 6 });

    const { investment, created } = await createInvestment(referred.id, {
      planId: plan.id,
      amountCents: 1_000_000, // $10,000 → $500 bonus
    });
    expect(created).toBe(true);

    const bonus = await prisma.referralEarning.findFirst({ where: { referrerId: referrer.id } });
    expect(bonus).not.toBeNull();
    expect(bonus!.amountCents).toBe(50_000);
    expect(bonus!.investmentId).toBe(investment!.id);
    expect(bonus!.referredUserId).toBe(referred.id);

    const refAccount = await prisma.account.findUnique({ where: { userId: referrer.id } });
    expect(refAccount!.balanceCents).toBe(50_000);
    expect(refAccount!.availableCents).toBe(50_000);

    const tx = await prisma.transaction.findFirst({ where: { userId: referrer.id, type: "REFERRAL_BONUS" } });
    expect(tx?.amountCents).toBe(50_000);
    expect(tx?.status).toBe("COMPLETED");
  });

  it("uses floor rounding for odd amounts — never overpays", async () => {
    const referrer = await createUser("Nana Yaa", "nana@test.qfs");
    const referred = await createUser("Ama Serwaa", "ama@test.qfs", { referredBy: referrer.id });
    await fundUser(referred.id, 1_000_000);
    const plan = await createPlan({ name: "Silver", minAmountCents: 1_000, monthlyRoiBps: 250, termMonths: 3 });

    const result = await createInvestment(referred.id, {
      planId: plan.id,
      amountCents: 99_999, // $999.99 → floor(4999.95c) = 4999c
    });
    expect(result.created).toBe(true);

    const bonus = await prisma.referralEarning.findFirst({ where: { referrerId: referrer.id } });
    expect(bonus!.amountCents).toBe(Math.floor((99_999 * 500) / 10000));
  });

  it("pays only once for the same referred investment (unique investmentId)", async () => {
    const referrer = await createUser("Kwabena", "kwabena@test.qfs");
    const referred = await createUser("Efua", "efua@test.qfs", { referredBy: referrer.id });
    await fundUser(referred.id, 3_000_000);
    const plan = await createPlan({ name: "Gem", minAmountCents: 5_000, monthlyRoiBps: 200, termMonths: 12 });

    const first = await createInvestment(referred.id, { planId: plan.id, amountCents: 500_000 });
    expect(first.created).toBe(true);

    // Same reference (idempotent retry) → no second bonus.
    const retry = await createInvestment(referred.id, {
      planId: plan.id,
      amountCents: 500_000,
      reference: (await prisma.transaction.findFirst({ where: { userId: referred.id, type: "INVESTMENT" } }))!.reference,
    });
    expect(retry.created).toBe(false);

    // A genuinely new investment → a second bonus allowed (different investmentId).
    const second = await createInvestment(referred.id, { planId: plan.id, amountCents: 300_000 });
    expect(second.created).toBe(true);

    const refEarnings = await prisma.referralEarning.findMany({ where: { referrerId: referrer.id } });
    expect(refEarnings).toHaveLength(2);

    const bonusTx = await prisma.transaction.count({ where: { userId: referrer.id, type: "REFERRAL_BONUS" } });
    expect(bonusTx).toBe(2);
  });

  it("pays no bonus when the rate is zero", async () => {
    await ensureSetting("referral_rate_bps", "0");
    const referrer = await createUser("Yaw", "yaw@test.qfs");
    const referred = await createUser("Akosua", "akosua@test.qfs", { referredBy: referrer.id });
    await fundUser(referred.id, 1_000_000);
    const plan = await createPlan({ name: "Zero", minAmountCents: 1_000, monthlyRoiBps: 100, termMonths: 6 });

    const result = await createInvestment(referred.id, { planId: plan.id, amountCents: 100_000 });
    expect(result.created).toBe(true);
    const count = await prisma.referralEarning.count({ where: { referrerId: referrer.id } });
    expect(count).toBe(0);
  });

  it("links a referred account to its referrer", async () => {
    const referrer = await createUserDirect("Linker", {});
    const referred = await createUser("Linked One", "linked1@test.qfs", { referredBy: referrer.id });
    const row = await prisma.user.findUnique({ where: { id: referred.id } });
    expect(row!.referredById).toBe(referrer.id);
    const referredCount = await prisma.user.count({ where: { referredById: referrer.id } });
    expect(referredCount).toBe(1);
  });
});