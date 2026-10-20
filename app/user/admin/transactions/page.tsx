"use client";
import { useText } from "@/lib/i18n/text";


import { useCallback, useState } from "react";
import { useLive } from "@/lib/use-live";
import {
  apiGet,
  DataTable,
  ErrorBanner,
  PageHeader,
  Pagination,
  Spinner,
  StatusPill,
  fmtDate,
  fmtMoney,
  type Column,
} from "@/components/admin/ui";
import type { AdminTxRow } from "@/lib/api-types";

const PAGE_LIMIT = 20;

export default function AdminTransactionsPage() {
  const tx = useText();
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AdminTxRow[]; total: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (t: string, s: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ page: String(p), limit: String(PAGE_LIMIT) });
      if (t !== "ALL") q.set("type", t);
      if (s !== "ALL") q.set("status", s);
      const d = await apiGet<{ items: AdminTxRow[]; total: number; totalPages: number }>(`/api/admin/transactions?${q.toString()}`);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useLive(() => load(type, status, page));

  const applyType = (v: string) => {
    setType(v);
    setPage(1);
    load(v, status, 1);
  };

  const applyStatus = (v: string) => {
    setStatus(v);
    setPage(1);
    load(type, v, 1);
  };

  const columns: Column<AdminTxRow>[] = [
    {
      label: "User",
      render: (t) => (
        <div style={{ minWidth: 0 }}>
          <b>{t.userName}</b>
          <span className="adm-cell-sub">{t.userEmail}</span>
        </div>
      ),
    },
    { label: "Type", render: (t) => <StatusPill status={t.type.replace(/_/g, " ").toLowerCase()} /> },
    { label: "Amount", render: (t) => <span className="num">{t.amount}</span> },
    {
      label: "Reference",
      render: (t) => <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{t.reference}</span>,
    },
    { label: "Method", render: (t) => t.method ?? "—" },
    { label: "Status", render: (t) => <StatusPill status={t.status} /> },
    { label: "Date", render: (t) => <span style={{ whiteSpace: "nowrap" }}>{tx.date(t.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title={tx("Transactions")}
        subtitle={tx("Every ledger movement across all accounts: deposits, withdrawals, investments, earnings and bonuses.")}
      />

      <div className="adm-inline-form">
        <select className="adm-select" value={type} onChange={(e) => applyType(e.target.value)}>
          <option value="ALL">{tx("All types")}</option>
          <option value="DEPOSIT">{tx("Deposits")}</option>
          <option value="WITHDRAWAL">{tx("Withdrawals")}</option>
          <option value="INVESTMENT">{tx("Investments")}</option>
          <option value="EARNING">{tx("Earnings")}</option>
          <option value="REFERRAL_BONUS">{tx("Referral bonuses")}</option>
          <option value="LOAN">{tx("Loans")}</option>
          <option value="ADJUSTMENT">{tx("Adjustments")}</option>
          <option value="PRINCIPAL_RETURN">{tx("Principal returns")}</option>
          <option value="SWAP">{tx("Crypto swaps")}</option>
        </select>
        <select className="adm-select" value={status} onChange={(e) => applyStatus(e.target.value)}>
          <option value="ALL">{tx("All statuses")}</option>
          <option value="COMPLETED">{tx("Completed")}</option>
          <option value="PENDING">{tx("Pending")}</option>
          <option value="CANCELLED">{tx("Cancelled")}</option>
          <option value="FAILED">{tx("Failed")}</option>
        </select>
      </div>

      {error && data && <ErrorBanner message={error} onRetry={() => void load(type, status, page)} />}
      {loading && !data ? (
        <Spinner label={tx("Loading transactions…")} />
      ) : error && !data ? (
        <ErrorBanner message={error} onRetry={() => load(type, status, page)} />
      ) : data ? (
        <>
          <DataTable columns={columns} rows={data.items} />
          <Pagination
            page={page}
            totalPages={data.totalPages}
            total={data.total}
            onChange={(p) => {
              setPage(p);
              load(type, status, p);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
