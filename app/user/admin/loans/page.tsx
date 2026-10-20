"use client";
import type { FeedbackMessage } from "@/components/ActionFeedback";
import { useText } from "@/lib/i18n/text";
import { useSearchParams } from "next/navigation";


import { useCallback, useState } from "react";
import { useLive } from "@/lib/use-live";
import {
  apiGet,
  apiSend,
  DataTable,
  ErrorBanner,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
  StatusPill,
  Toast,
  fmtDate,
  fmtMoney,
  type Column,
} from "@/components/admin/ui";

type LoanRow = {
  id: string;
  userName: string;
  userEmail: string;
  type: string;
  currency: string;
  amount: string;
  amountCents: number;
  period: number;
  status: string;
  createdAt: string;
  adminNote?: string;
};

const PAGE_LIMIT = 20;

export default function AdminLoansPage() {
  const tx = useText();
  const userId = useSearchParams().get("userId") ?? "";
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: LoanRow[]; total: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ row: LoanRow; action: "APPROVE" | "REJECT" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<FeedbackMessage | null>(null);

  const load = useCallback(async (s: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ page: String(p), limit: String(PAGE_LIMIT) });
      if (userId) q.set("userId", userId);
      if (s !== "ALL") q.set("status", s);
      const d = await apiGet<{ items: LoanRow[]; total: number; totalPages: number }>(`/api/admin/loans?${q.toString()}`);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useLive(() => load(status, page));

  const applyStatus = (s: string) => {
    setStatus(s);
    setPage(1);
    load(s, 1);
  };

  const submitDecision = async () => {
    if (!decision) return;
    setBusy(true);
    try {
      await apiSend(`/api/admin/loans/${decision.row.id}`, "PATCH", {
        action: decision.action,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setToast({message: "Loan review completed", description: tx(decision.action === "APPROVE" ? "The loan was approved. This decision does not disburse funds to the account." : "The loan was rejected. The user can see the decision and review note.")});
      setDecision(null);
      setNote("");
      load(status, page);
    } catch (e) {
      setToast({message: (e as Error).message, tone: "error"});
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<LoanRow>[] = [
    {
      label: "User",
      render: (l) => (
        <div style={{ minWidth: 0 }}>
          <b>{l.userName}</b>
          <span className="adm-cell-sub">{l.userEmail}</span>
        </div>
      ),
    },
    {
      label: "Loan",
      render: (l) => (
        <div>
          <b>{l.type}</b>
          <span className="adm-cell-sub">{tx("{value0} · {value1} months", { value0: l.currency, value1: l.period })}</span>
        </div>
      ),
    },
    { label: "Amount", render: (l) => <span className="num">{l.amount}</span> },
    { label: "Status", render: (l) => <StatusPill status={l.status} /> },
    { label: "Created", render: (l) => <span style={{ whiteSpace: "nowrap" }}>{tx.date(l.createdAt)}</span> },
    {
      label: "",
      className: "num",
      render: (l) =>
        l.status === "PENDING" ? (
          <div className="adm-actions-cell">
            <button className="adm-btn good sm" onClick={() => setDecision({ row: l, action: "APPROVE" })}>{tx("Approve")}</button>
            <button className="adm-btn danger sm" onClick={() => setDecision({ row: l, action: "REJECT" })}>{tx("Reject")}</button>
          </div>
        ) : (
          <span className="adm-cell-sub">{l.status.toLowerCase()}</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tx("Loans")}
        subtitle={tx("Approve or reject loan applications. Approved loans receive a due date based on the repayment period.")}
      />

      <div className="adm-inline-form">
        {userId && <p>{tx("Showing activity for the selected account.")} <a href="/admin/loans">{tx("Show all accounts")}</a></p>}
        <select className="adm-select" value={status} onChange={(e) => applyStatus(e.target.value)}>
          <option value="ALL">{tx("All statuses")}</option>
          <option value="PENDING">{tx("Pending")}</option>
          <option value="ACTIVE">{tx("Active")}</option>
          <option value="REJECTED">{tx("Rejected")}</option>
        </select>
      </div>

      {error && data && <ErrorBanner message={error} onRetry={() => void load(status, page)} />}
      {loading && !data ? (
        <Spinner label={tx("Loading loans…")} />
      ) : error && !data ? (
        <ErrorBanner message={error} onRetry={() => load(status, page)} />
      ) : data ? (
        <>
          <DataTable columns={columns} rows={data.items} />
          <Pagination
            page={page}
            totalPages={data.totalPages}
            total={data.total}
            onChange={(p) => {
              setPage(p);
              load(status, p);
            }}
          />
        </>
      ) : null}

      {decision && (
        <Modal busy={!!busy} title={tx("{value0} loan — {value1}", { value0: tx(decision.action === "APPROVE" ? "Approve" : "Reject"), value1: decision.row.userName })} onClose={() => setDecision(null)}>
          <p className="adm-confirm-text">{tx("{value0} · {value1} · {value2} months", { value0: tx.money(decision.row.amountCents), value1: decision.row.type, value2: decision.row.period })}</p>
          <div className="adm-field">
            <label>{tx("Admin note (optional, sent to the user)")}</label>
            <textarea
              className="adm-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tx("e.g. Your loan was approved. Disbursement is handled separately.")}
            />
          </div>
          <div className="adm-row-end">
            <button className="adm-btn ghost" onClick={() => setDecision(null)} disabled={busy}>{tx("Cancel")}</button>
            <button
              className={`adm-btn ${decision.action === "APPROVE" ? "good" : "danger"}`}
              onClick={submitDecision}
              disabled={busy}
            >
              {busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Working…")}</> : `${decision.action === "APPROVE" ? tx("Approve") : tx("Reject")} ${tx.money(decision.row.amountCents)}`}
            </button>
          </div>
        </Modal>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
