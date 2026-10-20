import "server-only";

import { prisma } from "../db";
import { ApiError } from "../api/errors";
import { monthlyRoiCents, monthsBetween, formatMoney } from "../money";
import { getSettingInt, newReference, notify, auditLog } from "./admin-log";

export type DepositInput = {
  amountCents: number;
  method: string;
  reference?: string;
  walletAddress?: string;
};
export type WithdrawalInput = {
  amountCents: number;
  method: string;
  details?: string;
  reference?: string;
  walletAddress?: string;
};
export type InvestInput = { planId: string; amountCents: number; reference?: string };

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

async function accountOrThrow(userId: string) {
  const account = await prisma.account.findUnique({ where: { userId } });
  if (!account) throw ApiError.notFound("Account not found");
  return account;
}

/* ---------------- Deposits ---------------- */

export async function createDeposit(userId: string, input: DepositInput) {
  const reference = input.reference?.trim() || newReference("DEP");
  const existing = await prisma.depositRequest.findUnique({ where: { reference } });
  if (existing) {
    if (existing.userId !== userId) throw ApiError.conflict("Reference already in use");
    return { request: existing, created: false };
  }
  try {
    const request = await prisma.depositRequest.create({
      data: {
        userId,
        amountCents: input.amountCents,
        method: input.method,
        reference,
        walletAddress: input.walletAddress,
      },
    });
    return { request, created: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const request = await prisma.depositRequest.findUnique({ where: { reference } });
      if (request) return { request, created: false };
    }
    throw e;
  }
}

export async function approveDeposit(actorId: string, requestId: string, note?: string) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const req = await tx.depositRequest.findUnique({ where: { id: requestId } });
    if (!req) throw ApiError.notFound("Deposit request not found");
    if (req.status !== "PENDING") throw ApiError.conflict("This request was already reviewed");

    const account = await tx.account.findUnique({ where: { userId: req.userId } });
    if (!account) throw ApiError.notFound("Account not found");

    const newBalance = account.balanceCents + req.amountCents;
    const newAvailable = account.availableCents + req.amountCents;

    const trx = await tx.transaction.create({
      data: {
        userId: req.userId,
        type: "DEPOSIT",
        amountCents: req.amountCents,
        method: req.method,
        reference: `TX-DEP-${req.id}`,
        status: "COMPLETED",
        completedAt: now,
        note: note || "Deposit approved",
      },
    });
    await tx.account.update({
      where: { userId: req.userId },
      data: { balanceCents: newBalance, availableCents: newAvailable },
    });
    await tx.ledgerEntry.create({
      data: {
        accountId: account.id,
        movement: "CREDIT",
        amountCents: req.amountCents,
        balanceAfterCents: newBalance,
        txId: trx.id,
        note: `Deposit via ${req.method}`,
      },
    });
    await tx.depositRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", reviewedById: actorId, reviewedAt: now, adminNote: note },
    });
    return { req, trx };
  });

  await auditLog(actorId, "ADMIN", "REQUEST.APPROVE_DEPOSIT", "DepositRequest", requestId, {
    amountCents: result.req.amountCents,
  });
  await notify(result.req.userId, "Deposit approved", "Your deposit has been approved and credited to your account.");
  return result;
}

export async function rejectDeposit(actorId: string, requestId: string, note?: string) {
  const req = await prisma.depositRequest.findUnique({ where: { id: requestId } });
  if (!req) throw ApiError.notFound("Deposit request not found");
  if (req.status !== "PENDING") throw ApiError.conflict("This request was already reviewed");

  await prisma.depositRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", reviewedById: actorId, reviewedAt: new Date(), adminNote: note },
  });
  await auditLog(actorId, "ADMIN", "REQUEST.REJECT_DEPOSIT", "DepositRequest", requestId, {
    amountCents: req.amountCents,
  });
  await notify(req.userId, "Deposit rejected", note || "Your deposit request was rejected.");
}

/* ---------------- Withdrawals ---------------- */

export async function createWithdrawal(userId: string, input: WithdrawalInput) {
  const reference = input.reference?.trim() || newReference("WD");
  const existing = await prisma.withdrawalRequest.findUnique({ where: { reference } });
  if (existing) {
    if (existing.userId !== userId) throw ApiError.conflict("Reference already in use");
    return { request: existing, created: false };
  }

  /* Seeded settings pin the floor and ceiling: min_withdrawal_cents (0 = no
     floor) and max_withdrawal_daily_cents (0 = unlimited). Rejected requests
     don't count against the cap; approved and pending ones do. */
  const [minWithdrawal, maxDaily] = await Promise.all([
    getSettingInt("min_withdrawal_cents", 0),
    getSettingInt("max_withdrawal_daily_cents", 0),
  ]);
  if (minWithdrawal > 0 && input.amountCents < minWithdrawal) {
    throw ApiError.badRequest(`Minimum withdrawal is ${formatMoney(minWithdrawal)}`);
  }
  if (maxDaily > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const agg = await prisma.withdrawalRequest.aggregate({
      where: { userId, createdAt: { gte: since }, status: { not: "REJECTED" } },
      _sum: { amountCents: true },
    });
    const used = agg._sum.amountCents ?? 0;
    if (used + input.amountCents > maxDaily) {
      throw ApiError.badRequest(
        `Daily withdrawal limit reached — ${formatMoney(maxDaily)} max per 24 hours`
      );
    }
  }

  const account = await accountOrThrow(userId);
  if (account.availableCents < input.amountCents) {
    throw ApiError.badRequest("Insufficient available balance for this withdrawal");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.account.findUnique({ where: { userId } });
      if (!fresh || fresh.availableCents < input.amountCents) {
        throw ApiError.badRequest("Insufficient available balance for this withdrawal");
      }
      const request = await tx.withdrawalRequest.create({
        data: {
          userId,
          amountCents: input.amountCents,
          method: input.method,
          details: input.details,
          reference,
          walletAddress: input.walletAddress,
        },
      });
      // Reserve the funds so they can't be spent while the request is pending.
      await tx.account.update({
        where: { userId },
        data: { availableCents: fresh.availableCents - input.amountCents },
      });
      await tx.ledgerEntry.create({
        data: {
          accountId: fresh.id,
          movement: "DEBIT",
          amountCents: input.amountCents,
          balanceAfterCents: fresh.balanceCents,
          note: `Reserved for withdrawal (${request.reference})`,
        },
      });
      return request;
    });
    return { request: result, created: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const request = await prisma.withdrawalRequest.findUnique({ where: { reference } });
      if (request) return { request, created: false };
    }
    throw e;
  }
}

export async function approveWithdrawal(actorId: string, requestId: string, note?: string) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const req = await tx.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!req) throw ApiError.notFound("Withdrawal request not found");
    if (req.status !== "PENDING") throw ApiError.conflict("This request was already reviewed");

    const account = await tx.account.findUnique({ where: { userId: req.userId } });
    if (!account) throw ApiError.notFound("Account not found");
    if (account.balanceCents < req.amountCents) {
      throw ApiError.badRequest("Insufficient account balance — cannot pay this withdrawal");
    }
    if (account.availableCents < req.amountCents) {
      throw ApiError.badRequest("Withdrawal funds are not available");
    }

    const newBalance = account.balanceCents - req.amountCents;
    // Available was already reduced when the request reserved the funds —
    // the payout only moves the balance; available stays put.
    const newAvailable = account.availableCents;

    const trx = await tx.transaction.create({
      data: {
        userId: req.userId,
        type: "WITHDRAWAL",
        amountCents: req.amountCents,
        method: req.method,
        reference: `TX-WD-${req.id}`,
        status: "COMPLETED",
        completedAt: now,
        note: note || "Withdrawal paid",
        meta: req.details ?? undefined,
      },
    });
    await tx.account.update({
      where: { userId: req.userId },
      data: { balanceCents: newBalance, availableCents: newAvailable },
    });
    await tx.ledgerEntry.create({
      data: {
        accountId: account.id,
        movement: "DEBIT",
        amountCents: req.amountCents,
        balanceAfterCents: newBalance,
        txId: trx.id,
        note: `Withdrawal via ${req.method}`,
      },
    });
    await tx.withdrawalRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", reviewedById: actorId, reviewedAt: now, adminNote: note, transactionId: trx.id },
    });
    return { req, trx };
  });

  await auditLog(actorId, "ADMIN", "REQUEST.APPROVE_WITHDRAWAL", "WithdrawalRequest", requestId, {
    amountCents: result.req.amountCents,
  });
  await notify(result.req.userId, "Withdrawal approved", "Your withdrawal has been approved and paid out.");
  return result;
}

export async function rejectWithdrawal(actorId: string, requestId: string, note?: string) {
  const result = await prisma.$transaction(async (tx) => {
    const req = await tx.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!req) throw ApiError.notFound("Withdrawal request not found");
    if (req.status !== "PENDING") throw ApiError.conflict("This request was already reviewed");

    const account = await tx.account.findUnique({ where: { userId: req.userId } });
    if (!account) throw ApiError.notFound("Account not found");

    // Release the reserved funds back to available.
    await tx.account.update({
      where: { userId: req.userId },
      data: { availableCents: account.availableCents + req.amountCents },
    });
    await tx.ledgerEntry.create({
      data: {
        accountId: account.id,
        movement: "CREDIT",
        amountCents: req.amountCents,
        balanceAfterCents: account.balanceCents,
        note: `Withdrawal reservation released (${req.reference})`,
      },
    });
    await tx.withdrawalRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", reviewedById: actorId, reviewedAt: new Date(), adminNote: note },
    });
    return req;
  });

  await auditLog(actorId, "ADMIN", "REQUEST.REJECT_WITHDRAWAL", "WithdrawalRequest", requestId, {
    amountCents: result.amountCents,
  });
  await notify(result.userId, "Withdrawal rejected", note || "Your withdrawal request was rejected and funds returned to your balance.");
  return result;
}

/* ---------------- Investments ---------------- */

export async function createInvestment(userId: string, input: InvestInput) {
  const plan = await prisma.investmentPlan.findUnique({ where: { id: input.planId } });
  if (!plan) throw ApiError.notFound("Investment plan not found");
  if (!plan.isActive) throw ApiError.badRequest("This plan is no longer available");
  if (input.amountCents < plan.minAmountCents) {
    throw ApiError.badRequest(
      `Minimum investment for this plan is $${(plan.minAmountCents / 100).toFixed(2)}`
    );
  }
  if (plan.maxAmountCents && input.amountCents > plan.maxAmountCents) {
    throw ApiError.badRequest(
      `Maximum investment for this plan is $${(plan.maxAmountCents / 100).toFixed(2)}`
    );
  }

  const account = await accountOrThrow(userId);
  if (account.availableCents < input.amountCents) {
    throw ApiError.badRequest("Insufficient available balance for this investment");
  }

  const reference = input.reference?.trim() || newReference("INV");
  const dup = await prisma.transaction.findUnique({ where: { reference } });
  if (dup) {
    const invId = dup.meta ? (JSON.parse(dup.meta) as { investmentId?: string }).investmentId : null;
    const investment = invId
      ? await prisma.investment.findUnique({ where: { id: invId } })
      : null;
    return { investment, created: false };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const now = new Date();
  const investResult = await prisma.$transaction(async (tx) => {
    const freshAccount = await tx.account.findUnique({ where: { userId } });
    if (!freshAccount || freshAccount.availableCents < input.amountCents) {
      throw ApiError.badRequest("Insufficient available balance for this investment");
    }

    const investment = await tx.investment.create({
      data: {
        userId,
        planId: plan.id,
        amountCents: input.amountCents,
        startDate: now,
        endDate: addMonths(now, plan.termMonths),
        monthlyRoiBps: plan.monthlyRoiBps,
        termMonths: plan.termMonths,
        payoutInterval: plan.payoutInterval,
      },
    });

    const trx = await tx.transaction.create({
      data: {
        userId,
        type: "INVESTMENT",
        amountCents: input.amountCents,
        method: "Main Balance",
        reference,
        status: "COMPLETED",
        completedAt: now,
        note: `${plan.name} · ${plan.termMonths} months`,
        meta: JSON.stringify({ investmentId: investment.id, planId: plan.id }),
      },
    });
    await tx.account.update({
      where: { userId },
      data: { availableCents: freshAccount.availableCents - input.amountCents },
    });
    await tx.ledgerEntry.create({
      data: {
        accountId: freshAccount.id,
        movement: "DEBIT",
        amountCents: input.amountCents,
        balanceAfterCents: freshAccount.balanceCents,
        txId: trx.id,
        note: `Invested in ${plan.name}`,
      },
    });
    return { investment, trx, freshAccount };
  });

  // Referral bonus — once per referred investment (unique investmentId constraint).
  if (user?.referredById) {
    const bonusBps = await getSettingInt("referral_rate_bps", 500);
    const bonus = Math.floor((input.amountCents * bonusBps) / 10000);
    if (bonus > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.referralEarning.create({
            data: {
              referrerId: user.referredById!,
              referredUserId: userId,
              investmentId: investResult.investment.id,
              amountCents: bonus,
            },
          });
          const refAccount = await tx.account.findUnique({ where: { userId: user.referredById! } });
          if (!refAccount) throw ApiError.notFound("Referrer account not found");
          await tx.transaction.create({
            data: {
              userId: user.referredById!,
              type: "REFERRAL_BONUS",
              amountCents: bonus,
              reference: `TX-REF-${investResult.investment.id}`,
              status: "COMPLETED",
              completedAt: now,
              note: `Referral bonus — ${user.name}`,
              meta: JSON.stringify({ referredUserId: userId }),
            },
          });
          await tx.account.update({
            where: { userId: user.referredById! },
            data: {
              balanceCents: refAccount.balanceCents + bonus,
              availableCents: refAccount.availableCents + bonus,
            },
          });
          await tx.ledgerEntry.create({
            data: {
              accountId: refAccount.id,
              movement: "CREDIT",
              amountCents: bonus,
              balanceAfterCents: refAccount.balanceCents + bonus,
              note: `Referral bonus — ${user.name}`,
            },
          });
        });
        await notify(
          user.referredById,
          "Referral bonus earned",
          `You earned a $${(bonus / 100).toFixed(2)} referral bonus from ${user.name}.`
        );
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }

  await notify(
    userId,
    "Investment started",
    `Your ${plan.name} investment of $${(input.amountCents / 100).toFixed(2)} is now active.`
  );
  return { investment: investResult.investment, created: true };
}

/* ---------------- Earnings accrual (idempotent materializer) ---------------- */

export async function accrueEarningsForUser(userId: string, now = new Date()) {
  const investments = await prisma.investment.findMany({
    where: { userId, status: "ACTIVE" },
    include: { plan: true },
  });

  let credited = 0;
  let totalCents = 0;

  for (const inv of investments) {
    const completed = Math.min(
      Math.max(monthsBetween(inv.startDate, now), 0),
      inv.plan.termMonths
    );
    const monthly = monthlyRoiCents(inv.amountCents, inv.plan.monthlyRoiBps);
    if (monthly <= 0) continue;

    for (let p = 1; p <= completed; p++) {
      const reference = `EARN-${inv.id}-${p}`;
      const existing = await prisma.transaction.findUnique({ where: { reference } });
      if (existing) continue;

      try {
        const result = await prisma.$transaction(async (tx) => {
          const account = await tx.account.findUnique({ where: { userId } });
          if (!account) throw ApiError.notFound("Account not found");
          const trx = await tx.transaction.create({
            data: {
              userId,
              type: "EARNING",
              amountCents: monthly,
              reference,
              status: "COMPLETED",
              completedAt: now,
              note: `ROI payout — ${inv.plan.name} (month ${p})`,
              meta: JSON.stringify({ investmentId: inv.id }),
            },
          });
          await tx.account.update({
            where: { userId },
            data: {
              balanceCents: account.balanceCents + monthly,
              availableCents: account.availableCents + monthly,
            },
          });
          await tx.ledgerEntry.create({
            data: {
              accountId: account.id,
              movement: "CREDIT",
              amountCents: monthly,
              balanceAfterCents: account.balanceCents + monthly,
              txId: trx.id,
              note: `ROI payout — ${inv.plan.name}`,
            },
          });
          await tx.investment.update({
            where: { id: inv.id },
            data: { paidOutCents: inv.paidOutCents + monthly },
          });
          return trx;
        });
        credited += 1;
        totalCents += monthly;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }

  return { credited, totalCents };
}

/* ---------------- Manual balance adjustments (admin) ---------------- */

/**
 * Credit (positive) or debit (negative) a single user's balance.
 * Debits can never push available below zero — the same guard that protects
 * withdrawals. Every change lands as a completed ADJUSTMENT transaction plus a
 * ledger entry, the user is notified, and the action is audit-logged.
 */
export async function adjustUserBalance(actorId: string, userId: string, amountCents: number, note: string) {
  if (!Number.isInteger(amountCents) || amountCents === 0) {
    throw ApiError.badRequest("Adjustment amount must be a non-zero whole number of cents");
  }
  /* Mirrors updateUser: admins manage USER accounts, never themselves or each
     other. The bulk path already filters to role USER, so this keeps both
     entry points honest. */
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!target) throw ApiError.notFound("User not found");
  if (target.role !== "USER") {
    throw ApiError.badRequest("Adjustments target regular user accounts only");
  }

  const now = new Date();
  const debit = amountCents < 0;
  const abs = Math.abs(amountCents);

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({ where: { userId } });
    if (!account) throw ApiError.notFound("Account not found");
    if (debit && account.availableCents < abs) {
      throw ApiError.badRequest("Cannot deduct more than the user's available balance");
    }

    const trx = await tx.transaction.create({
      data: {
        userId,
        type: "ADJUSTMENT",
        amountCents: abs,
        method: "Manual",
        reference: newReference("ADJ"),
        status: "COMPLETED",
        completedAt: now,
        note,
        adminNote: note,
      },
    });

    const newBalance = account.balanceCents + amountCents;
    const newAvailable = account.availableCents + amountCents;
    await tx.account.update({
      where: { userId },
      data: { balanceCents: newBalance, availableCents: newAvailable },
    });
    await tx.ledgerEntry.create({
      data: {
        accountId: account.id,
        movement: debit ? "DEBIT" : "CREDIT",
        amountCents: abs,
        balanceAfterCents: newBalance,
        txId: trx.id,
        note: `Manual ${debit ? "deduction" : "credit"} — ${note}`,
      },
    });

    return { newBalance, newAvailable };
  });

  await auditLog(actorId, "ADMIN", "FIN.ADJUST", "User", userId, {
    amountCents: debit ? -abs : abs,
    note,
  });
  await notify(
    userId,
    debit ? "Account adjustment" : "Profit credited",
    `${debit ? "Deducted" : "Credited"} ${formatMoney(abs)} to your balance${note ? ` — ${note}` : ""}.`
  );

  return { applied: true, debit, abs, ...result };
}

/**
 * Apply one adjustment to every non-admin user (active and suspended alike —
 * the money is theirs regardless of login state). Under-funded accounts are
 * skipped for debits, never zeroed. Reports how many actually landed.
 */
export async function adjustAllUsers(actorId: string, amountCents: number, note: string) {
  const users = await prisma.user.findMany({
    where: { role: "USER" },
    select: { id: true },
  });

  const results: Array<{ userId: string; applied: boolean; reason?: string }> = [];
  for (const u of users) {
    try {
      await adjustUserBalance(actorId, u.id, amountCents, note);
      results.push({ userId: u.id, applied: true });
    } catch (e) {
      results.push({
        userId: u.id,
        applied: false,
        reason: e instanceof ApiError ? e.message : "Unexpected error",
      });
    }
  }

  const applied = results.filter((r) => r.applied).length;
  const skipped = results.length - applied;
  await auditLog(actorId, "ADMIN", "FIN.ADJUST_ALL", "User", null, {
    amountCents,
    note,
    total: results.length,
    applied,
    skipped,
  });

  return { total: results.length, applied, skipped };
}
