import "server-only";

import { prisma } from "../db";
import { ApiError } from "../api/errors";
import { formatMoney } from "../money";
import type { AdminRequestRow, AdminStats, AdminTxRow, AdminUserRow, AuditRow } from "../api-types";
import { auditLog, notify } from "./admin-log";
import { approveDeposit, approveWithdrawal, rejectDeposit, rejectWithdrawal } from "./account";
import { revokeUserSessions } from "../session";

/* ---------------- Stats ---------------- */

export async function getAdminStats(): Promise<AdminStats> {
  const now = new Date();
  const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const [
    totalUsers,
    newUsers30d,
    activeUsers,
    suspendedUsers,
    balanceAgg,
    completedDeposits,
    completedWithdrawals,
    pendingDeposits,
    pendingWithdrawals,
    pendingLoans,
    activeInvestments,
    activeInvestmentsAgg,
    totalPlans,
    approvals30d,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.user.count({ where: { status: "ACTIVE", role: "USER" } }),
    prisma.user.count({ where: { status: "SUSPENDED" } }),
    prisma.account.aggregate({ _sum: { balanceCents: true } }),
    prisma.transaction.aggregate({
      where: { type: "DEPOSIT", status: "COMPLETED" },
      _sum: { amountCents: true },
    }),
    prisma.transaction.aggregate({
      where: { type: "WITHDRAWAL", status: "COMPLETED" },
      _sum: { amountCents: true },
    }),
    prisma.depositRequest.aggregate({ where: { status: "PENDING" }, _count: true, _sum: { amountCents: true } }),
    prisma.withdrawalRequest.aggregate({ where: { status: "PENDING" }, _count: true, _sum: { amountCents: true } }),
    prisma.loan.count({ where: { status: "PENDING" } }),
    prisma.investment.count({ where: { status: "ACTIVE" } }),
    prisma.investment.aggregate({ where: { status: "ACTIVE" }, _sum: { amountCents: true } }),
    prisma.investmentPlan.count({ where: { isActive: true } }),
    prisma.auditLog.count({ where: { createdAt: { gte: monthAgo } } }),
  ]);

  const totalBalanceCents = balanceAgg._sum.balanceCents ?? 0;
  const totalDepositsCents = completedDeposits._sum.amountCents ?? 0;
  const totalWithdrawalsCents = completedWithdrawals._sum.amountCents ?? 0;
  return {
    totalUsers,
    newUsers30d,
    activeUsers,
    suspendedUsers,
    totalBalanceCents,
    totalBalance: formatMoney(totalBalanceCents),
    totalDepositsCents,
    totalDeposits: formatMoney(totalDepositsCents),
    totalWithdrawalsCents,
    totalWithdrawals: formatMoney(totalWithdrawalsCents),
    pendingDeposits: { count: pendingDeposits._count, sumCents: pendingDeposits._sum.amountCents ?? 0 },
    pendingWithdrawals: { count: pendingWithdrawals._count, sumCents: pendingWithdrawals._sum.amountCents ?? 0 },
    pendingLoans,
    activeInvestments,
    activeInvestmentsCents: activeInvestmentsAgg._sum.amountCents ?? 0,
    totalPlans,
    approvals30d,
  };
}

/* ---------------- Users ---------------- */

export async function listUsers(input: { search?: string; role?: string; status?: string; page?: number; limit?: number }) {
  const where: Record<string, unknown> = {};
  if (input.search) {
    /* `mode: "insensitive"` is required, not cosmetic. On SQLite `contains`
       compiled to LIKE, which is case-insensitive; on Postgres LIKE is
       case-SENSITIVE, so without this an admin typing "john" would silently
       stop finding "John". Wallet addresses are stored checksummed (mixed
       case), so that search breaks too. */
    const q = input.search;
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { referralCode: { contains: q, mode: "insensitive" } },
      // so support can find the account behind a wallet address
      { wallets: { some: { address: { contains: q, mode: "insensitive" } } } },
    ];
  }
  if (input.role && input.role !== "ALL") where.role = input.role;
  if (input.status && input.status !== "ALL") where.status = input.status;

  const page = Math.max(input.page ?? 1, 1);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        account: true,
        _count: { select: { referred: true } },
        wallets: { orderBy: { lastUsedAt: "desc" }, take: 1 },
      },
    }),
  ]);

  /* Lifetime deposit/withdrawal totals per visible user. Two groupBy queries
     keyed to this page's users — never an N+1, and only COMPLETED money counts. */
  const ids = users.map((u) => u.id);
  const [depAgg, wdAgg] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, type: "DEPOSIT", status: "COMPLETED" },
      _sum: { amountCents: true },
    }),
    prisma.transaction.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, type: "WITHDRAWAL", status: "COMPLETED" },
      _sum: { amountCents: true },
    }),
  ]);
  const depByUser = new Map(depAgg.map((r) => [r.userId, r._sum.amountCents ?? 0]));
  const wdByUser = new Map(wdAgg.map((r) => [r.userId, r._sum.amountCents ?? 0]));

  const rows: AdminUserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    avatarUrl: u.avatarUrl,
    role: u.role,
    status: u.status,
    country: u.country,
    kycLevel: u.kycLevel,
    balanceCents: u.account?.balanceCents ?? 0,
    availableCents: u.account?.availableCents ?? 0,
    depositCents: depByUser.get(u.id) ?? 0,
    withdrawalCents: wdByUser.get(u.id) ?? 0,
    memberSince: u.memberSince.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    referralCode: u.referralCode,
    referredCount: u._count.referred,
    walletAddress: u.wallets[0]?.address ?? null,
  }));

  return { items: rows, total, page, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

export async function updateUser(
  actorId: string,
  targetId: string,
  action: "SUSPEND" | "ACTIVATE" | "SET_ROLE",
  role?: "USER" | "ADMIN"
) {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw ApiError.notFound("User not found");
  if (targetId === actorId && action !== "ACTIVATE") {
    throw ApiError.badRequest("You cannot change your own account from here");
  }

  await auditLog(actorId, "ADMIN", `USER.${action}`, "User", targetId, { role });

  switch (action) {
    case "SUSPEND":
      await prisma.user.update({ where: { id: targetId }, data: { status: "SUSPENDED" } });
      await revokeUserSessions(targetId);
      await notify(targetId, "Account suspended", "Your account has been suspended. Contact support.");
      break;
    case "ACTIVATE":
      await prisma.user.update({ where: { id: targetId }, data: { status: "ACTIVE" } });
      await notify(targetId, "Account activated", "Your account is active again.");
      break;
    case "SET_ROLE":
      await prisma.user.update({ where: { id: targetId }, data: { role: role ?? "USER" } });
      await notify(targetId, "Account updated", `Your account role is now ${role ?? "USER"}.`);
      break;
  }
  return prisma.user.findUnique({ where: { id: targetId } });
}

/* ---------------- Requests ---------------- */

export async function listRequests(input: { type: "DEPOSIT" | "WITHDRAWAL"; status?: string; page?: number; limit?: number }) {
  const page = Math.max(input.page ?? 1, 1);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const where: Record<string, unknown> = {};
  if (input.status && input.status !== "ALL") where.status = input.status;

  type Row = {
    id: string;
    userId: string;
    user: { id: string; name: string; email: string };
    amountCents: number;
    method: string;
    reference: string;
    details: string | null;
    walletAddress: string | null;
    status: string;
    createdAt: Date;
    adminNote: string | null;
  };

  const map = (r: Row): AdminRequestRow => ({
    id: r.id,
    userId: r.userId,
    userName: r.user.name,
    userEmail: r.user.email,
    amountCents: r.amountCents,
    amount: formatMoney(r.amountCents),
    method: r.method,
    reference: r.reference,
    details: r.details ?? undefined,
    walletAddress: r.walletAddress,
    status: r.status as AdminRequestRow["status"],
    createdAt: r.createdAt.toISOString(),
    adminNote: r.adminNote ?? undefined,
  });

  if (input.type === "DEPOSIT") {
    const [total, rows] = await Promise.all([
      prisma.depositRequest.count({ where }),
      prisma.depositRequest.findMany({
        where: where as any,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return { items: (rows as unknown as Row[]).map(map), total, page, totalPages: Math.max(Math.ceil(total / limit), 1) };
  }

  const [total, rows] = await Promise.all([
    prisma.withdrawalRequest.count({ where }),
    prisma.withdrawalRequest.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  return { items: (rows as unknown as Row[]).map(map), total, page, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

export async function decideRequest(
  actorId: string,
  type: "DEPOSIT" | "WITHDRAWAL",
  requestId: string,
  action: "APPROVE" | "REJECT",
  note?: string
): Promise<"APPROVED" | "REJECTED"> {
  const approve = action === "APPROVE";
  if (type === "DEPOSIT") {
    await (approve ? approveDeposit(actorId, requestId, note) : rejectDeposit(actorId, requestId, note));
  } else {
    await (approve ? approveWithdrawal(actorId, requestId, note) : rejectWithdrawal(actorId, requestId, note));
  }
  // Report the decision itself: the reject helpers differ in what they return.
  return approve ? "APPROVED" : "REJECTED";
}

/* ---------------- Transactions ---------------- */

export async function listTransactions(input: { type?: string; status?: string; page?: number; limit?: number }) {
  const where: Record<string, unknown> = {};
  if (input.type && input.type !== "ALL") where.type = input.type;
  if (input.status && input.status !== "ALL") where.status = input.status;
  const page = Math.max(input.page ?? 1, 1);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  const items: AdminTxRow[] = rows.map((t) => ({
    id: t.id,
    userName: t.user.name,
    userEmail: t.user.email,
    type: t.type,
    amount: formatMoney(t.amountCents),
    currency: t.currency,
    status: t.status,
    reference: t.reference,
    method: t.method ?? undefined,
    createdAt: t.createdAt.toISOString(),
    note: t.note ?? undefined,
  }));

  return { items, total, page, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

/* ---------------- Plans ---------------- */

export async function listPlans() {
  return prisma.investmentPlan.findMany({ orderBy: { sort: "asc" } });
}

export async function createPlan(data: {
  name: string;
  description?: string;
  minAmountCents: number;
  maxAmountCents?: number;
  monthlyRoiBps: number;
  termMonths: number;
  isActive?: boolean;
  sort?: number;
  color?: string;
}) {
  return prisma.investmentPlan.create({ data });
}

export async function updatePlan(id: string, data: Record<string, unknown>) {
  const plan = await prisma.investmentPlan.findUnique({ where: { id } });
  if (!plan) throw ApiError.notFound("Plan not found");
  const { name, description, minAmountCents, maxAmountCents, monthlyRoiBps, termMonths, isActive, sort, color } = data as any;
  return prisma.investmentPlan.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(minAmountCents !== undefined ? { minAmountCents } : {}),
      ...(maxAmountCents !== undefined ? { maxAmountCents } : {}),
      ...(monthlyRoiBps !== undefined ? { monthlyRoiBps } : {}),
      ...(termMonths !== undefined ? { termMonths } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(sort !== undefined ? { sort } : {}),
      ...(color !== undefined ? { color } : {}),
    },
  });
}

export async function deletePlan(id: string) {
  const plan = await prisma.investmentPlan.findUnique({ where: { id }, include: { investments: true } });
  if (!plan) throw ApiError.notFound("Plan not found");
  if (plan.investments.length > 0) {
    // Soft-delete: plans with active history are deactivated instead.
    return prisma.investmentPlan.update({ where: { id }, data: { isActive: false } });
  }
  return prisma.investmentPlan.delete({ where: { id } });
}

/* ---------------- Loans ---------------- */

export async function listLoans(input: { status?: string; page?: number; limit?: number }) {
  const where: Record<string, unknown> = {};
  if (input.status && input.status !== "ALL") where.status = input.status;
  const page = Math.max(input.page ?? 1, 1);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const [total, rows] = await Promise.all([
    prisma.loan.count({ where }),
    prisma.loan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);
  return {
    items: rows.map((l) => ({
      id: l.id,
      userName: l.user.name,
      userEmail: l.user.email,
      type: l.type,
      currency: l.currency,
      amount: formatMoney(l.amountCents),
      amountCents: l.amountCents,
      period: l.period,
      status: l.status,
      createdAt: l.createdAt.toISOString(),
      adminNote: l.adminNote ?? undefined,
    })),
    total,
    page,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  };
}

export async function decideLoan(actorId: string, loanId: string, action: "APPROVE" | "REJECT", note?: string) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw ApiError.notFound("Loan not found");
  if (loan.status !== "PENDING") throw ApiError.conflict("This loan was already reviewed");

  const now = new Date();
  if (action === "APPROVE") {
    const due = new Date(now);
    due.setUTCMonth(due.getUTCMonth() + Math.min(Math.max(loan.period, 1), 120));
    await prisma.loan.update({
      where: { id: loanId },
      data: { status: "ACTIVE", dueDate: due, decidedById: actorId, decidedAt: now, adminNote: note },
    });
    await auditLog(actorId, "ADMIN", "LOAN.APPROVE", "Loan", loanId, { amountCents: loan.amountCents });
    await notify(loan.userId, "Loan approved", `Your ${loan.type} loan of ${formatMoney(loan.amountCents)} has been approved.`);
  } else {
    await prisma.loan.update({
      where: { id: loanId },
      data: { status: "REJECTED", decidedById: actorId, decidedAt: now, adminNote: note },
    });
    await auditLog(actorId, "ADMIN", "LOAN.REJECT", "Loan", loanId, { amountCents: loan.amountCents });
    await notify(loan.userId, "Loan rejected", note || "Your loan application was rejected.");
  }
  return prisma.loan.findUnique({ where: { id: loanId } });
}

/* ---------------- Content: documents, reviews, markets ---------------- */

export async function listDocuments() {
  return prisma.document.findMany({ orderBy: { sort: "asc" } });
}
export async function createDocument(d: any) {
  return prisma.document.create({ data: d });
}
export async function updateDocument(id: string, d: Record<string, unknown>) {
  if (!(await prisma.document.findUnique({ where: { id } }))) throw ApiError.notFound("Document not found");
  return prisma.document.update({ where: { id }, data: d });
}
export async function deleteDocument(id: string) {
  if (!(await prisma.document.findUnique({ where: { id } }))) throw ApiError.notFound("Document not found");
  return prisma.document.delete({ where: { id } });
}

export async function listReviews() {
  return prisma.review.findMany({ orderBy: [{ status: "asc" }, { sort: "asc" }] });
}
export async function createReview(r: any) {
  return prisma.review.create({ data: r });
}
export async function updateReview(id: string, r: Record<string, unknown>) {
  if (!(await prisma.review.findUnique({ where: { id } }))) throw ApiError.notFound("Review not found");
  return prisma.review.update({ where: { id }, data: r });
}
export async function deleteReview(id: string) {
  if (!(await prisma.review.findUnique({ where: { id } }))) throw ApiError.notFound("Review not found");
  return prisma.review.delete({ where: { id } });
}

export async function listMarkets() {
  return prisma.marketAsset.findMany({ orderBy: [{ type: "asc" }, { sort: "asc" }] });
}
export async function createMarket(m: any) {
  return prisma.marketAsset.create({ data: m });
}
export async function updateMarket(id: string, m: Record<string, unknown>) {
  if (!(await prisma.marketAsset.findUnique({ where: { id } }))) throw ApiError.notFound("Market asset not found");
  return prisma.marketAsset.update({ where: { id }, data: m });
}
export async function deleteMarket(id: string) {
  if (!(await prisma.marketAsset.findUnique({ where: { id } }))) throw ApiError.notFound("Market asset not found");
  return prisma.marketAsset.delete({ where: { id } });
}

/* ---------------- Settings ---------------- */

export async function listSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  return Object.fromEntries(rows.map((s) => [s.key, s.value]));
}

export async function upsertSetting(key: string, value: string) {
  return prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/* ---------------- Audit ---------------- */

export async function listAudit(input: { page?: number; limit?: number }): Promise<{ items: AuditRow[]; total: number; page: number; totalPages: number }> {
  const page = Math.max(input.page ?? 1, 1);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const [total, rows] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { actor: { select: { name: true } } },
    }),
  ]);
  return {
    items: rows.map((a) => ({
      id: a.id,
      actorName: a.actor.name,
      actorRole: a.actorRole,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId ?? undefined,
      meta: a.meta ?? undefined,
      createdAt: a.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  };
}