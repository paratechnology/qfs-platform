import "server-only";

import type { OverviewData } from "./api-types";
import {
  CRYPTO,
  DOCUMENTS,
  INVESTMENT_PLANS,
  MARKET_COLORS,
  METALS,
  STOCKS,
} from "@/components/dashboard/data";

function marketItems(items: typeof METALS): OverviewData["markets"]["metals"] {
  return items.map((item) => ({
    sym: item.sym,
    name: item.name,
    full: item.full,
    price: item.price,
    chg: item.chg,
    up: item.up,
    color: MARKET_COLORS[item.sym] ?? "#8c85a8",
  }));
}

/** Read-only sample payload for the local login when PostgreSQL is unavailable. */
export function getDevOverview(): OverviewData {
  const email = process.env.QFS_DEV_LOGIN_EMAIL ?? "dev@qfs.local";
  return {
    user: {
      name: "Local Demo",
      email,
      role: "USER",
      avatarUrl: "/avatars/avatar1.jpg",
      country: "Local preview",
      referralCode: "DEMO",
      memberSince: "Sample account",
      kycLevel: 0,
    },
    balance: {
      totalCents: 1248000,
      availableCents: 848000,
      total: "$12,480.00",
      available: "$8,480.00",
      thisMonthDeposits: "$2,500.00",
    },
    investmentSummary: { activeCount: 1, activeAmount: "$4,000.00", activeTrend: "+$140.00/mo" },
    earnings: { total: "$1,240.00", thisMonth: "$180.00", count: 8 },
    accrual: { pending: "$24.1935", items: [{ id: "demo-investment", plan: "QFS Growth", payoutInterval: "MONTHLY", monthlyRate: "3.50%", principal: "$4,000.00", monthlyProfit: "$140.00", startedAt: "2026-09-01T00:00:00Z", endsAt: "2027-03-01T00:00:00Z", pending: "$24.1935", paid: "$180.00" }] },
    withdrawals: { total: "$650.00", count: 2 },
    loans: { total: "$0.00", count: 0 },
    balanceCards: [
      { key: "balance", label: "Total Balance", amount: "$12,480.00", sub: "Available: $8,480.00", trend: "+$2,500.00 this month", trendDir: "up", action: "Add Fund", tone: "lime", actionModal: "deposit" },
      { key: "investments", label: "Active Investments", amount: "$4,000.00", sub: "1 active plan", trend: "QFS Growth +3.5%/mo", trendDir: "up", action: "View Investments", tone: "ghost", actionModal: "investments" },
      { key: "earnings", label: "Investment Profit", amount: "$1,240.00", sub: "Paid to balance", trend: "$24.1935 pending payout", trendDir: "up", action: "View History", tone: "ghost", actionModal: "history" },
      { key: "withdrawals", label: "Total Withdrawals", amount: "$650.00", sub: "2 withdrawals", trend: "Last: Sep 18, 2026", trendDir: "down", action: "Withdraw", tone: "ghost", actionModal: "withdraw" },
      { key: "loans", label: "Active Loans", amount: "$0.00", sub: "No active loans", trend: "View applications", trendDir: "flat", action: "View Loans", tone: "ghost", actionModal: "loans" },
    ],
    recentTx: [
      { id: "demo-deposit", kind: "dep", title: "Deposit", meta: "Bank Transfer · Sample", amount: "+$2,500.00", cls: "plus", date: "Sep 28, 2026", status: "Completed" },
      { id: "demo-earning", kind: "earn", title: "Investment earnings", meta: "QFS Growth · Sample", amount: "+$180.00", cls: "plus", date: "Sep 25, 2026", status: "Completed" },
      { id: "demo-withdrawal", kind: "wd", title: "Withdrawal", meta: "Bank Transfer · Sample", amount: "-$250.00", cls: "minus", date: "Sep 18, 2026", status: "Completed" },
    ],
    markets: {
      metals: marketItems(METALS),
      stocks: marketItems(STOCKS),
      crypto: marketItems(CRYPTO),
    },
    documents: DOCUMENTS,
    reviews: [],
    cards: [],
    plans: INVESTMENT_PLANS.map((plan, index) => ({
      id: `demo-plan-${index}`,
      name: plan.name,
      min: plan.min,
      max: plan.max,
      roi: plan.roi,
      term: plan.term,
      payoutInterval: plan.payoutInterval,
    })),
    referral: { url: "/?ref=DEMO", count: 0, earnings: "$0.00" },
    notifications: {
      unread: 1,
      items: [{ id: "demo-notice", title: "Local demo", body: "This dashboard uses sample data. Account actions are disabled.", read: false, time: "Today" }],
    },
    payout: [],
  };
}
