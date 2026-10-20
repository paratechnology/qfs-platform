import "server-only";

import { prisma } from "../db";
import { formatMoney, monthlyRoiCents } from "../money";
import { referralUrl } from "./referral";
import { accrueEarningsForUser } from "./account";
import { getLiveQuotes, type LiveQuote } from "../live-prices";
import { getPayoutMethods } from "../deposit-payout";
import type {
  BalanceCard,
  DocItem,
  MarketItem,
  OverviewData,
  PayoutMethod,
  ReviewItem,
  TxItem,
} from "../api-types";

const TX_TYPE_LABEL: Record<string, string> = {
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  INVESTMENT: "Investment",
  EARNING: "Earning",
  REFERRAL_BONUS: "Referral Bonus",
  LOAN: "Loan",
  ADJUSTMENT: "Adjustment",
};

function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtMemberSince(d: Date): string {
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function txKind(type: string): TxItem["kind"] {
  switch (type) {
    case "DEPOSIT":
      return "dep";
    case "INVESTMENT":
      return "inv";
    case "WITHDRAWAL":
      return "wd";
    case "REFERRAL_BONUS":
      return "ref";
    default:
      return "earn";
  }
}

function txToDisplay(t: {
  id: string;
  type: string;
  amountCents: number;
  status: string;
  method?: string | null;
  note?: string | null;
  reference: string;
  createdAt: Date;
}): TxItem {
  const isOut = t.type === "WITHDRAWAL";
  const meta =
    t.method && t.type !== "INVESTMENT"
      ? `${t.method} · ${t.reference}`
      : t.note || t.reference;
  const statusLabel =
    t.status === "COMPLETED"
      ? t.type === "INVESTMENT"
        ? "Active"
        : "Completed"
      : t.status === "PENDING"
        ? "Pending"
        : t.status === "CANCELLED"
          ? "Cancelled"
          : "Failed";
  return {
    id: t.id,
    kind: txKind(t.type),
    title: TX_TYPE_LABEL[t.type] ?? t.type,
    meta,
    amount: `${isOut ? "-" : "+"}${formatMoney(t.amountCents)}`,
    cls: isOut ? "minus" : "plus",
    date: fmtDateTime(t.createdAt),
    status: statusLabel,
  };
}

export async function getDashboardOverview(userId: string): Promise<OverviewData> {
  // Materialize any earnings that have matured since last view (idempotent).
  await accrueEarningsForUser(userId);

  const [user, account, investments, transactions, plans, markets, documents, reviews, cards, notifications, loans, referredCount, referralEarnings, liveQuotes, payoutMethods] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.account.findUnique({ where: { userId } }),
      prisma.investment.findMany({
        where: { userId, status: "ACTIVE" },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.investmentPlan.findMany({ where: { isActive: true }, orderBy: { sort: "asc" } }),
      prisma.marketAsset.findMany({ where: { isActive: true }, orderBy: { sort: "asc" } }),
      prisma.document.findMany({ where: { isActive: true }, orderBy: { sort: "asc" } }),
      prisma.review.findMany({ where: { status: "APPROVED" }, orderBy: { sort: "asc" }, take: 20 }),
      prisma.card.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 6 }),
      prisma.loan.findMany({ where: { userId, status: { in: ["ACTIVE", "PENDING"] } }, orderBy: { createdAt: "desc" } }),
      prisma.user.count({ where: { referredById: userId } }),
      prisma.referralEarning.aggregate({ where: { referrerId: userId }, _sum: { amountCents: true } }),
      // Live quotes run alongside the DB reads (single-flight, cached 60s).
      getLiveQuotes().catch(() => new Map<string, LiveQuote>()),
      getPayoutMethods().catch(() => [] as PayoutMethod[]),
    ]);

  if (!user || !account) throw new Error("User or account missing");

  const totalCents = account.balanceCents;
  const availableCents = account.availableCents;

  const activeAmountCents = investments.reduce((s, i) => s + i.amountCents, 0);
  const topPlan = investments[0];

  // Earnings totals
  const earningsRows = await prisma.transaction.findMany({
    where: { userId, type: { in: ["EARNING", "REFERRAL_BONUS"] }, status: "COMPLETED" },
    select: { amountCents: true, createdAt: true },
  });
  const earningsCents = earningsRows.reduce((s, e) => s + e.amountCents, 0);
  const now = new Date();
  const earningsThisMonth = earningsRows
    .filter((e) => e.createdAt.getMonth() === now.getMonth() && e.createdAt.getFullYear() === now.getFullYear())
    .reduce((s, e) => s + e.amountCents, 0);

  const withdrawalsRows = await prisma.transaction.findMany({
    where: { userId, type: "WITHDRAWAL", status: "COMPLETED" },
    select: { amountCents: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const withdrawalsCents = withdrawalsRows.reduce((s, w) => s + w.amountCents, 0);

  const depositsThisMonth = await prisma.transaction.aggregate({
    where: {
      userId,
      type: "DEPOSIT",
      status: "COMPLETED",
      createdAt: {
        gte: new Date(now.getFullYear(), now.getMonth(), 1),
      },
    },
    _sum: { amountCents: true },
  });

  const loanTotalCents = loans
    .filter((l) => l.status === "ACTIVE")
    .reduce((s, l) => s + l.amountCents, 0);

  const lastWithdrawal = withdrawalsRows[0];

  const balanceCards: BalanceCard[] = [
    {
      key: "balance",
      label: "Total Balance",
      amount: formatMoney(totalCents),
      sub: `Available: ${formatMoney(availableCents)}`,
      trend: `+${formatMoney(depositsThisMonth._sum.amountCents ?? 0)} this month`,
      trendDir: "up",
      action: "Add Fund",
      tone: "lime",
      actionModal: "deposit",
    },
    {
      key: "investments",
      label: "Active Investments",
      amount: formatMoney(activeAmountCents),
      sub: `${investments.length} active plans`,
      trend: topPlan
        ? `${topPlan.plan.name} +${(topPlan.plan.monthlyRoiBps / 100).toFixed(1)}%/mo`
        : "Start investing today",
      trendDir: "up",
      action: "View Investments",
      tone: "ghost",
      actionModal: "investments",
    },
    {
      key: "earnings",
      label: "Total Earnings",
      amount: formatMoney(earningsCents),
      sub: "All time",
      trend: `+${formatMoney(earningsThisMonth)} this month`,
      trendDir: "up",
      action: "View All",
      tone: "ghost",
      actionModal: "history",
    },
    {
      key: "withdrawals",
      label: "Total Withdrawals",
      amount: formatMoney(withdrawalsCents),
      sub: `${withdrawalsRows.length} withdrawals`,
      trend: lastWithdrawal ? `Last: ${fmtDateTime(lastWithdrawal.createdAt)}` : "No withdrawals yet",
      trendDir: "down",
      action: "Withdraw",
      tone: "ghost",
      actionModal: "withdraw",
    },
    {
      key: "loans",
      label: "Active Loans",
      amount: formatMoney(loanTotalCents),
      sub: loanTotalCents > 0 ? "Active balance" : "No active loans",
      trend: loans.some((loan) => loan.status === "PENDING") ? "Application under review" : "View applications",
      trendDir: "flat",
      action: "View Loans",
      tone: "ghost",
      actionModal: "loans",
    },
  ];

  const marketItems: MarketItem[] = markets.map((m) => ({
    sym: m.symbol,
    name: m.name,
    full: m.full,
    price: m.price,
    chg: m.change,
    up: m.direction === "up",
    color: m.color,
  }));

  // Overlay live quotes where available; DB values remain the fallback.
  for (const it of marketItems) {
    const q = liveQuotes.get(it.sym);
    if (q) {
      it.price = q.price;
      it.chg = q.chg;
      it.up = q.up;
    }
  }

  const byType = (type: string) => marketItems.filter((_, i) => markets[i].type === type);

  const docItems: DocItem[] = documents.map((d) => ({
    code: d.code,
    label: d.title,
    flag: d.flagPath,
    fileUrl: d.fileUrl,
  }));

  const reviewItems: ReviewItem[] = reviews.map((r) => ({
    name: r.userName,
    meta: r.country ? `${r.country} · Verified Investor` : "Verified Investor",
    avatar: r.avatarUrl || "/avatars/avatar1.jpg",
    stars: r.rating,
    text: r.text,
  }));

  const cardItems = cards.map((c) => ({
    id: c.id,
    brand: c.brand,
    last4: c.last4,
    expiry: c.expiry,
    holder: c.holder,
    color: c.color,
    status: c.status,
  }));

  const notificationsUnread = await prisma.notification.count({
    where: { userId, readAt: null },
  });

  const referralEarningsCents = referralEarnings._sum.amountCents ?? 0;

  return {
    user: {
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
      country: user.country,
      referralCode: user.referralCode,
      memberSince: `Member since ${fmtMemberSince(user.memberSince)}`,
      kycLevel: user.kycLevel,
    },
    balance: {
      totalCents,
      availableCents,
      total: formatMoney(totalCents),
      available: formatMoney(availableCents),
      thisMonthDeposits: formatMoney(depositsThisMonth._sum.amountCents ?? 0),
    },
    investmentSummary: {
      activeCount: investments.length,
      activeAmount: formatMoney(activeAmountCents),
      activeTrend: topPlan
        ? `${topPlan.plan.name} +$${(
            monthlyRoiCents(topPlan.amountCents, topPlan.plan.monthlyRoiBps) / 100
          ).toFixed(2)}/mo`
        : "Start investing today",
    },
    earnings: { total: formatMoney(earningsCents), thisMonth: formatMoney(earningsThisMonth), count: earningsRows.length },
    accrual: { pending: "Unavailable", items: investments.map((investment) => ({
      id: investment.id,
      plan: investment.plan.name,
      payoutInterval: investment.payoutInterval === "HOURLY" ? "HOURLY" as const : "MONTHLY" as const,
      monthlyRate: `${((investment.monthlyRoiBps || investment.plan.monthlyRoiBps) / 100).toFixed(2)}%`,
      principal: formatMoney(investment.amountCents),
      monthlyProfit: formatMoney(monthlyRoiCents(investment.amountCents,
        investment.monthlyRoiBps || investment.plan.monthlyRoiBps)),
      startedAt: investment.startDate.toISOString(),
      endsAt: investment.endDate?.toISOString() ?? null,
      pending: "Unavailable",
      paid: formatMoney(investment.paidOutCents),
    })) },
    withdrawals: { total: formatMoney(withdrawalsCents), count: withdrawalsRows.length },
    loans: { total: formatMoney(loanTotalCents), count: loans.length },
    balanceCards,
    recentTx: transactions.map(txToDisplay),
    markets: {
      metals: byType("METAL"),
      stocks: byType("STOCK"),
      crypto: byType("CRYPTO"),
    },
    documents: docItems,
    reviews: reviewItems,
    cards: cardItems,
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      min: formatMoney(p.minAmountCents),
      max: p.maxAmountCents ? formatMoney(p.maxAmountCents) : undefined,
      roi: `${(p.monthlyRoiBps / 100).toFixed(1)}% monthly`,
      term: `${p.termMonths} months`,
      payoutInterval: "MONTHLY",
    })),
    referral: {
      url: referralUrl(user.referralCode),
      count: referredCount,
      earnings: formatMoney(referralEarningsCents),
    },
    notifications: {
      unread: notificationsUnread,
      items: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body ?? undefined,
        read: n.readAt !== null,
        time: fmtDateTime(n.createdAt),
      })),
    },
    payout: payoutMethods,
  };
}
