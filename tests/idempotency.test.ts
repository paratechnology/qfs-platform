import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import {
  approveDeposit,
  approveWithdrawal,
  createDeposit,
  createInvestment,
  createWithdrawal,
  rejectDeposit,
  rejectWithdrawal,
} from "../lib/services/account";
import { ApiError } from "../lib/api/errors";
import { ensureSetting, createPlan, createUser, fundUser, resetDb } from "./helpers";

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  await ensureSetting("referral_rate_bps", "500");
});

function expectApiError(fn: () => Promise<unknown>, status: number) {
  return expect(fn()).rejects.toMatchObject({ status });
}

describe("deposit flow — idempotency + atomic approval", () => {
  it("rejects duplicate references with the same idempotency key", async () => {
    const user = await createUser("Dep One", "dep1@test.qfs");
    const first = await createDeposit(user.id, { amountCents: 10_000, method: "Bank Transfer", reference: "DEP-ABC-1" });
    expect(first.created).toBe(true);

    const retry = await createDeposit(user.id, { amountCents: 10_000, method: "Bank Transfer", reference: "DEP-ABC-1" });
    expect(retry.created).toBe(false);
    expect(retry.request.id).toBe(first.request.id);
    expect(await prisma.depositRequest.count({ where: { userId: user.id } })).toBe(1);
  });

  it("auto-generates unique references when none provided", async () => {
    const user = await createUser("Dep Two", "dep2@test.qfs");
    const a = await createDeposit(user.id, { amountCents: 5_000, method: "Bitcoin" });
    const b = await createDeposit(user.id, { amountCents: 6_000, method: "Ethereum" });
    expect(a.request.reference).not.toBe(b.request.reference);
    expect(a.request.status).toBe("PENDING");
  });

  it("approving a deposit credits balance + ledger atomically and exactly once", async () => {
    const user = await createUser("Dep Three", "dep3@test.qfs");
    const admin = await createUser("Boss", "boss@test.qfs");
    await fundUser(admin.id, 0);

    const { request } = await createDeposit(user.id, { amountCents: 87_650, method: "Bank Transfer" });
    const before = await prisma.account.findUnique({ where: { userId: user.id } });

    const approved = await approveDeposit(admin.id, request.id, "Verified");
    expect(approved.trx.amountCents).toBe(87_650);

    const after = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(after!.balanceCents).toBe(before!.balanceCents + 87_650);
    expect(after!.availableCents).toBe(before!.availableCents + 87_650);

    const ledger = await prisma.ledgerEntry.findMany({ where: { accountId: after!.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].movement).toBe("CREDIT");
    expect(ledger[0].balanceAfterCents).toBe(after!.balanceCents);

    // Double approval is rejected.
    await expectApiError(() => approveDeposit(admin.id, request.id), 409);
    const count = await prisma.transaction.count({ where: { userId: user.id, type: "DEPOSIT" } });
    expect(count).toBe(1);
  });

  it("rejecting a deposit creates no transaction and leaves balances untouched", async () => {
    const user = await createUser("Dep Four", "dep4@test.qfs");
    const admin = await createUser("Boss4", "boss4@test.qfs");
    const { request } = await createDeposit(user.id, { amountCents: 10_000, method: "Bitcoin" });

    await rejectDeposit(admin.id, request.id, "Invalid proof");

    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account!.balanceCents).toBe(0);
    expect(account!.availableCents).toBe(0);
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);

    const req = await prisma.depositRequest.findUnique({ where: { id: request.id } });
    expect(req!.status).toBe("REJECTED");
    expect(req!.adminNote).toBe("Invalid proof");
  });
});

describe("withdrawal flow — reservation prevents overspending", () => {
  it("reserves funds at submission and blocks overspending", async () => {
    const user = await createUser("Wd One", "wd1@test.qfs");
    await fundUser(user.id, 100_000);

    const { request } = await createWithdrawal(user.id, { amountCents: 40_000, method: "Bitcoin" });
    expect(request.status).toBe("PENDING");

    let account = await prisma.account.findUnique({ where: { userId: user.id } });
    // Balance unchanged (still owned), available reduced by the reservation.
    expect(account!.balanceCents).toBe(100_000);
    expect(account!.availableCents).toBe(60_000);

    // Try to spend more than the remaining available → blocked.
    await expectApiError(
      () => createWithdrawal(user.id, { amountCents: 70_000, method: "Ethereum" }),
      400
    );

    // A second withdrawal fitting the remaining available is fine.
    const second = await createWithdrawal(user.id, { amountCents: 60_000, method: "Ethereum" });
    expect(second.created).toBe(true);
    account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account!.availableCents).toBe(0);
  });

  it("is idempotent for the same reference", async () => {
    const user = await createUser("Wd Two", "wd2@test.qfs");
    await fundUser(user.id, 50_000);
    const first = await createWithdrawal(user.id, { amountCents: 10_000, method: "Bank Transfer", reference: "WD-ONE-1" });
    const retry = await createWithdrawal(user.id, { amountCents: 10_000, method: "Bank Transfer", reference: "WD-ONE-1" });
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(await prisma.withdrawalRequest.count({ where: { userId: user.id } })).toBe(1);
  });

  it("approving a withdrawal pays out and debits the ledger exactly once", async () => {
    const user = await createUser("Wd Three", "wd3@test.qfs");
    const admin = await createUser("Boss3", "boss3@test.qfs");
    await fundUser(user.id, 100_000);

    const { request } = await createWithdrawal(user.id, {
      amountCents: 25_000,
      method: "Bank Transfer",
      details: "GTB 0123456789",
    });
    await approveWithdrawal(admin.id, request.id, "Paid");

    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account!.balanceCents).toBe(75_000);
    expect(account!.availableCents).toBe(75_000);

    const ledger = await prisma.ledgerEntry.findMany({ where: { accountId: account!.id }, orderBy: { createdAt: "asc" } });
    expect(ledger).toHaveLength(2); // reservation DEBIT + payout DEBIT
    expect(ledger[0].movement).toBe("DEBIT");
    expect(ledger[1].movement).toBe("DEBIT");
    expect(ledger[1].balanceAfterCents).toBe(75_000);

    const tx = await prisma.transaction.findFirst({ where: { userId: user.id, type: "WITHDRAWAL" } });
    expect(tx!.status).toBe("COMPLETED");
    expect(tx!.meta).toBe("GTB 0123456789");

    const before = await prisma.account.findUnique({ where: { userId: user.id } });
    await expectApiError(() => approveWithdrawal(admin.id, request.id), 409);
    const after = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(after!.balanceCents).toBe(before!.balanceCents);
  });

  it("rejecting a withdrawal releases the reservation back to available", async () => {
    const user = await createUser("Wd Four", "wd4@test.qfs");
    const admin = await createUser("Boss4", "boss4@test.qfs");
    await fundUser(user.id, 100_000);

    const { request } = await createWithdrawal(user.id, { amountCents: 30_000, method: "Ethereum" });
    let account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account!.availableCents).toBe(70_000);

    await rejectWithdrawal(admin.id, request.id, "Details unclear");
    account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account!.availableCents).toBe(100_000);
    expect(account!.balanceCents).toBe(100_000);

    // User can now withdraw again.
    const again = await createWithdrawal(user.id, { amountCents: 90_000, method: "Bitcoin" });
    expect(again.created).toBe(true);
  });
});

describe("investment flow — debits available, keeps balance, idempotent", () => {
  it("debits available balance but not total balance", async () => {
    const user = await createUser("Inv One", "inv1@test.qfs");
    await fundUser(user.id, 200_000);
    const plan = await createPlan({ name: "InvPlan", minAmountCents: 5_000, monthlyRoiBps: 300, termMonths: 6 });

    const { investment, created } = await createInvestment(user.id, { planId: plan.id, amountCents: 80_000 });
    expect(created).toBe(true);
    expect(investment!.amountCents).toBe(80_000);
    expect(investment!.endDate!.getUTCMonth()).toBe((investment!.startDate.getUTCMonth() + 6) % 12);

    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account!.balanceCents).toBe(200_000);
    expect(account!.availableCents).toBe(120_000);
  });

  it("rejects investments above the available balance", async () => {
    const user = await createUser("Inv Two", "inv2@test.qfs");
    await fundUser(user.id, 50_000);
    const plan = await createPlan({ name: "InvPlan2", minAmountCents: 5_000, monthlyRoiBps: 300, termMonths: 6 });
    await expectApiError(() => createInvestment(user.id, { planId: plan.id, amountCents: 70_000 }), 400);
  });

  it("enforces plan min/max bounds", async () => {
    const user = await createUser("Inv Three", "inv3@test.qfs");
    await fundUser(user.id, 1_000_000);
    const plan = await createPlan({
      name: "InvPlan3",
      minAmountCents: 50_000,
      maxAmountCents: 500_000,
      monthlyRoiBps: 300,
      termMonths: 6,
    });
    await expectApiError(() => createInvestment(user.id, { planId: plan.id, amountCents: 10_000 }), 400);
    await expectApiError(() => createInvestment(user.id, { planId: plan.id, amountCents: 900_000 }), 400);
  });

  it("is idempotent when retried with the same reference", async () => {
    const user = await createUser("Inv Four", "inv4@test.qfs");
    await fundUser(user.id, 500_000);
    const plan = await createPlan({ name: "InvPlan4", minAmountCents: 5_000, monthlyRoiBps: 300, termMonths: 6 });

    const first = await createInvestment(user.id, { planId: plan.id, amountCents: 100_000, reference: "INV-RETRY-1" });
    const retry = await createInvestment(user.id, { planId: plan.id, amountCents: 100_000, reference: "INV-RETRY-1" });
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.investment?.id).toBe(first.investment!.id);

    const account = await prisma.account.findUnique({ where: { userId: user.id } });
    expect(account!.availableCents).toBe(400_000); // debited once
  });
});