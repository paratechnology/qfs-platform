import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { accrueEarningsForUser } from "../lib/services/account";
import { monthlyRoiCents } from "../lib/money";
import { createPlan, createUserDirect, fundUser, resetDb } from "./helpers";

const NOW = new Date(Date.UTC(2026, 5, 15)); // June 15, 2026

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

describe("accrueEarningsForUser — deterministic accrual + idempotent materializer", () => {
  it("credits exactly one completed EARNING per elapsed month", async () => {
    const user = await createUserDirect("AccrualOne");
    await fundUser(user.id, 1_000_000); // $10,000
    const plan = await createPlan({ name: "Growth", minAmountCents: 5_000, monthlyRoiBps: 500, termMonths: 6 });

    const start = new Date(Date.UTC(2026, 2, 1)); // March 1
    const investment = await prisma.investment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amountCents: 1_000_000,
        startDate: start,
        endDate: new Date(Date.UTC(2026, 8, 1)),
      },
    });

    const result = await accrueEarningsForUser(user.id, NOW);
    expect(result.credited).toBe(3); // Mar, Apr, May
    expect(result.totalCents).toBe(3 * 50_000); // $500/month

    const earnings = await prisma.transaction.findMany({
      where: { userId: user.id, type: "EARNING" },
      orderBy: { reference: "asc" },
    });
    expect(earnings).toHaveLength(3);
    earnings.forEach((e, i) => {
      expect(e.reference).toBe(`EARN-${investment.id}-${i + 1}`);
      expect(e.amountCents).toBe(50_000);
      expect(e.status).toBe("COMPLETED");
    });

    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account?.balanceCents).toBe(1_000_000 + 150_000);
    expect(account?.availableCents).toBe(1_000_000 + 150_000);
  });

  it("is idempotent — a second pass credits nothing new", async () => {
    const user = await createUserDirect("AccrualIdem");
    await fundUser(user.id, 500_000);
    const plan = await createPlan({ name: "Idem", minAmountCents: 5_000, monthlyRoiBps: 250, termMonths: 12 });
    await prisma.investment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amountCents: 500_000,
        startDate: new Date(Date.UTC(2026, 3, 1)),
      },
    });

    const first = await accrueEarningsForUser(user.id, NOW);
    const second = await accrueEarningsForUser(user.id, NOW);
    expect(first.credited).toBe(2);
    expect(second.credited).toBe(0);
    expect(second.totalCents).toBe(0);

    const count = await prisma.transaction.count({ where: { userId: user.id, type: "EARNING" } });
    expect(count).toBe(2);
    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account?.balanceCents).toBe(500_000 + 2 * 12_500);
  });

  it("materializes only newly matured months when time advances", async () => {
    const user = await createUserDirect("AccrualAdvance");
    await fundUser(user.id, 100_000);
    const plan = await createPlan({ name: "Advance", minAmountCents: 1_000, monthlyRoiBps: 1000, termMonths: 24 });
    await prisma.investment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amountCents: 100_000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
      },
    });

    const early = await accrueEarningsForUser(user.id, new Date(Date.UTC(2026, 1, 1))); // Feb
    expect(early.credited).toBe(1);

    const later = await accrueEarningsForUser(user.id, new Date(Date.UTC(2026, 3, 1))); // Apr
    expect(later.credited).toBe(2); // Mar + Apr
    expect(later.totalCents).toBe(2 * monthlyRoiCents(100_000, 1000));
  });

  it("never accrues beyond the plan term", async () => {
    const user = await createUserDirect("AccrualTerm");
    await fundUser(user.id, 200_000);
    const plan = await createPlan({ name: "Short", minAmountCents: 1_000, monthlyRoiBps: 300, termMonths: 2 });
    await prisma.investment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amountCents: 200_000,
        startDate: new Date(Date.UTC(2025, 6, 1)),
      },
    });

    const result = await accrueEarningsForUser(user.id, NOW);
    expect(result.credited).toBe(2); // capped at termMonths
    const count = await prisma.transaction.count({ where: { userId: user.id, type: "EARNING" } });
    expect(count).toBe(2);
  });

  it("does not accrue for inactive or future investments", async () => {
    const user = await createUserDirect("AccrualInactive");
    await fundUser(user.id, 300_000);
    const plan = await createPlan({ name: "Mixed", minAmountCents: 1_000, monthlyRoiBps: 300, termMonths: 12 });

    await prisma.investment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amountCents: 100_000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        status: "CLOSED",
      },
    });
    await prisma.investment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amountCents: 100_000,
        startDate: new Date(Date.UTC(2027, 0, 1)), // starts after NOW
      },
    });

    const result = await accrueEarningsForUser(user.id, NOW);
    expect(result.credited).toBe(0);
  });

  it("keeps ledger + account exactly balanced after accrual", async () => {
    const user = await createUserDirect("AccrualLedger");
    await fundUser(user.id, 420_000);
    const plan = await createPlan({ name: "Ledger", minAmountCents: 1_000, monthlyRoiBps: 425, termMonths: 12 });
    await prisma.investment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amountCents: 420_000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
      },
    });

    await accrueEarningsForUser(user.id, NOW);
    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    const creditSum = await prisma.ledgerEntry.aggregate({ where: { accountId: account!.id }, _sum: { amountCents: true } });

    expect(account!.balanceCents).toBe(420_000 + creditSum._sum.amountCents!);
    // Every EARNING has a matching ledger CREDIT.
    const earningSum = await prisma.transaction.aggregate({
      where: { userId: user.id, type: "EARNING" },
      _sum: { amountCents: true },
    });
    expect(creditSum._sum.amountCents).toBe(earningSum._sum.amountCents);
  });
});