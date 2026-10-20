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
  type Column,
} from "@/components/admin/ui";
import type { AuditRow } from "@/lib/api-types";

const PAGE_LIMIT = 50;
const TARGET_LABEL: Record<string, string> = {
  User: "User",
  DepositRequest: "Deposit",
  WithdrawalRequest: "Withdrawal",
  InvestmentPlan: "Plan",
  Investment: "Investment",
  Loan: "Loan",
  Document: "Document",
  Review: "Review",
  MarketAsset: "Market",
  Setting: "Setting",
};

export default function AdminAuditPage() {
  const tx = useText();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AuditRow[]; total: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<{ items: AuditRow[]; total: number; totalPages: number }>(
        `/api/admin/audit?page=${p}&limit=${PAGE_LIMIT}`
      );
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useLive(() => load(page));

  const columns: Column<AuditRow>[] = [
    { label: "When", render: (a) => <span style={{ whiteSpace: "nowrap" }}>{tx.date(a.createdAt)}</span> },
    {
      label: "Actor",
      render: (a) => (
        <div>
          <b>{a.actorName}</b>
          <span className="adm-cell-sub">{a.actorRole}</span>
        </div>
      ),
    },
    { label: "Action", render: (a) => <StatusPill status={a.action} /> },
    { label: "Target", render: (a) => TARGET_LABEL[a.targetType] ?? a.targetType },
    {
      label: "Target ID",
      render: (a) =>
        a.targetId ? (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>{a.targetId}</span>
        ) : (
          "—"
        ),
    },
    {
      label: "Meta",
      render: (a) =>
        a.meta ? (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: "var(--dash-muted)" }}>
            {a.meta}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tx("Audit Log")}
        subtitle={tx("Immutable record of every admin action: approvals, rejections, role changes and content edits.")}
      />

      {error && data && <ErrorBanner message={error} onRetry={() => void load(page)} />}
      {loading && !data ? (
        <Spinner label={tx("Loading audit log…")} />
      ) : error && !data ? (
        <ErrorBanner message={error} onRetry={() => load(page)} />
      ) : data ? (
        <>
          <DataTable columns={columns} rows={data.items} />
          <Pagination
            page={page}
            totalPages={data.totalPages}
            total={data.total}
            onChange={(p) => {
              setPage(p);
              load(p);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
