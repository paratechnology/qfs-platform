"use client";
import { useText } from "@/lib/i18n/text";


import { useFetch, Spinner, ErrorBanner, fmtMoney } from "@/components/admin/ui";
import { DashboardIcon, TrendingUp, Wallet, ArrowDown, ArrowUp } from "@/components/dashboard/icons";
import type { AdminStats } from "@/lib/api-types";
import type { ReactNode } from "react";

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: ReactNode; icon: ReactNode }) {
  const tx = useText();
  return (
    <div className="adm-stat">
      <div className="adm-stat-top">
        <span className="adm-stat-label">{tx(label)}</span>
        <span className="adm-stat-ico">{icon}</span>
      </div>
      <div className="adm-stat-value">{value}</div>
      {sub && <div className="adm-stat-sub">{sub}</div>}
    </div>
  );
}

export default function AdminOverviewPage() {
  const tx = useText();
  const { data, error, loading, reload } = useFetch<AdminStats>("/api/admin/stats");

  // `error` alone must not blank the screen: a failed background poll keeps the
  // last good numbers on display until the next successful one.
  if (loading && !data) return <Spinner label={tx("Loading overview…")} />;
  if (!data) return <ErrorBanner message={error ?? "Failed to load overview"} onRetry={reload} />;

  return (
    <div>
      <div className="adm-hero">
        <div>
          <h2>{tx("Operations Overview")}</h2>
          <p>{tx("Monitor account balances, pending reviews and platform activity at a glance. Approve deposits and withdrawals from the Requests section — every action is recorded in the audit log.")}</p>
        </div>
        <div className="adm-hero-actions">
          <a className="adm-btn primary" href="/admin/requests">{tx("Review Requests")}</a>
          <a className="adm-btn ghost" href="/admin/transactions">{tx("All Transactions")}</a>
        </div>
      </div>

      <div className="adm-stats-grid">
        <Stat label={tx("Total Users")} value={String(data.totalUsers)} sub={<>{tx("+{value0} new in 30d", { value0: data.newUsers30d })}</>} icon={<DashboardIcon />} />
        <Stat label={tx("Active Users")} value={String(data.activeUsers)} sub={`${data.suspendedUsers} suspended`} icon={<Wallet />} />
        <Stat label={tx("USD account balances")} value={data.totalBalance} sub="All user accounts" icon={<Wallet />} />
        <Stat label={tx("USD deposits")} value={data.totalDeposits} sub="Lifetime, credited" icon={<ArrowDown />} />
        <Stat label={tx("Total Withdrawals")} value={data.totalWithdrawals} sub="Lifetime, paid out" icon={<ArrowUp />} />
        <Stat label={tx("Pending Deposits")} value={String(data.pendingDeposits.count)} sub={tx("Pending review")} icon={<ArrowDown />} />
        <Stat label={tx("Pending Withdrawals")} value={String(data.pendingWithdrawals.count)} sub={`${tx.money(data.pendingWithdrawals.sumCents)} awaiting review`} icon={<ArrowUp />} />
        <Stat label={tx("Pending Loans")} value={String(data.pendingLoans)} sub="Loan applications to review" icon={<Wallet />} />
        <Stat label={tx("Active Investments")} value={String(data.activeInvestments)} sub={`${tx.money(data.activeInvestmentsCents)} committed`} icon={<TrendingUp />} />
        <Stat label={tx("Active Plans")} value={String(data.totalPlans)} sub="Investment plans online" icon={<TrendingUp />} />
        <Stat label={tx("Approvals (30d)")} value={String(data.approvals30d)} sub="Audited admin actions" icon={<DashboardIcon />} />
      </div>

      <div className="adm-card adm-card-pad">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <b style={{ fontSize: 14 }}>{tx("Priority queue")}</b>
          <span style={{ fontSize: 12, color: "var(--dash-muted)" }}>{tx("Updated live")}</span>
        </div>
        <div className="adm-notice" style={{ marginBottom: 10 }}>
          <ArrowDown />
          <span>
            <b style={{ color: "var(--dash-text)" }}>{tx("{value0} deposit request(s)", { value0: data.pendingDeposits.count })}</b>{" "}{tx("totaling")}<b style={{ color: "var(--dash-text)" }}>{tx.money(data.pendingDeposits.sumCents)}</b>{" "}{tx("are under review. Head to")}{" "}
            <a className="adm-link-btn" href="/admin/requests">{tx("Requests")}</a>{" "}{tx("to approve or reject them.")}</span>
        </div>
        <div className="adm-notice" style={{ marginBottom: 10 }}>
          <ArrowUp />
          <span>
            <b style={{ color: "var(--dash-text)" }}>{tx("{value0} withdrawal request(s)", { value0: data.pendingWithdrawals.count })}</b>{" "}{tx("totaling")}<b style={{ color: "var(--dash-text)" }}>{tx.money(data.pendingWithdrawals.sumCents)}</b>{" "}{tx("are under review — funds are already reserved for these payouts.")}</span>
        </div>
        <div className="adm-notice">
          <Wallet />
          <span>
            <b style={{ color: "var(--dash-text)" }}>{tx("{value0} pending loan application(s)", { value0: data.pendingLoans })}</b>{tx("in the queue. Review them in the Loans section.")}</span>
        </div>
      </div>
    </div>
  );
}
