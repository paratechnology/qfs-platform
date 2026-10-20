"use client";
import type { FeedbackMessage } from "@/components/ActionFeedback";
import { useText } from "@/lib/i18n/text";
import { useSearchParams } from "next/navigation";


import { useCallback, useEffect, useRef, useState } from "react";
import { LIVE_MS, useLive } from "@/lib/use-live";
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
import type { AdminRequestRow } from "@/lib/api-types";

const PAGE_LIMIT = 20;

type Decision = { row: AdminRequestRow; action: "APPROVE" | "REJECT"; type: "DEPOSIT" | "WITHDRAWAL" };

export default function AdminRequestsPage() {
  const tx = useText();
  const searchParams = useSearchParams();
  const userId = searchParams.get("userId") ?? "";
  const [type, setType] = useState<"DEPOSIT" | "WITHDRAWAL">(searchParams.get("type") === "WITHDRAWAL" ? "WITHDRAWAL" : "DEPOSIT");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AdminRequestRow[]; total: number; totalPages: number } | null>(null);
  const [dataQuery, setDataQuery] = useState("");
  const query = JSON.stringify([type, status, page, userId]);
  const activeQuery = useRef(query);
  activeQuery.current = query;
  const loadGeneration = useRef(0);
  const currentData = dataQuery === query ? data : null;
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<FeedbackMessage | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const decisionLock = useRef(false);
  useEffect(() => { setTxHash(decision?.row.txHash ?? ""); setNote(""); setDecisionError(""); }, [decision?.row.id, decision?.action, type]);

  const load = useCallback(
    async (t: string, s: string, p: number) => {
      const generation = ++loadGeneration.current;
      const requestedQuery = JSON.stringify([t, s, p, userId]);
      setError(null);
      try {
        const q = new URLSearchParams({ type: t, page: String(p), limit: String(PAGE_LIMIT) });
        if (userId) q.set("userId", userId);
        if (s !== "ALL") q.set("status", s);
        const d = await apiGet<{ items: AdminRequestRow[]; total: number; totalPages: number }>(
          `/api/admin/requests?${q.toString()}`
        );
        if (generation === loadGeneration.current && requestedQuery === activeQuery.current) { setData(d); setDataQuery(requestedQuery); }
      } catch (e) {
        if (generation === loadGeneration.current && requestedQuery === activeQuery.current) setError((e as Error).message);
      }
    },
    [userId]
  );

  const reload = () => load(type, status, page);

  useLive(reload, LIVE_MS, false);
  useEffect(() => { void load(type, status, page); }, [load, type, status, page]);
  const routeType = searchParams.get("type") === "WITHDRAWAL" ? "WITHDRAWAL" : "DEPOSIT";
  useEffect(() => { setType(routeType); setPage(1); }, [routeType, userId]);

  const switchType = (t: "DEPOSIT" | "WITHDRAWAL") => {
    setType(t);
    setPage(1);
  };

  const switchStatus = (s: string) => {
    setStatus(s);
    setPage(1);
  };

  const submitDecision = async () => {
    if (!decision || decisionLock.current) return;
    decisionLock.current = true;
    setDecisionError("");
    setBusy(true);
    const decisionType = decision.type;
    try {
      const result = await apiSend<{alreadyReviewed?: boolean}>(`/api/admin/requests/${decision.row.id}?type=${decisionType}`, "PATCH", {
        action: decision.action,
        ...(decision.row.assetKey && decision.action === "APPROVE" && txHash.trim() !== (decision.row.txHash ?? "").trim() ? { txHash: txHash.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setToast(result.alreadyReviewed ? {message: tx("This request was already reviewed"), tone:"info"} : {message: tx(decisionType === "DEPOSIT" ? decision.action === "APPROVE" ? "Deposit approved" : "Deposit rejected" : decision.action === "APPROVE" ? "Withdrawal approved" : "Withdrawal rejected"), description: decision.action === "APPROVE" ? tx(decisionType === "DEPOSIT" ? "The deposit is confirmed and the account balance has been updated." : "The withdrawal review is complete. The recorded payout is available in transaction history.") : tx("The review is complete. The user can see the updated status and review note.")});
      setDecision(null);
      setNote("");
      setTxHash("");
      reload();
    } catch (e) {
      setDecisionError((e as Error).message);
    } finally {
      decisionLock.current = false;
      setBusy(false);
    }
  };

  const columns: Column<AdminRequestRow>[] = [
    {
      label: "User",
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <b>{r.userName}</b>
          <span className="adm-cell-sub">{r.userEmail}</span>
        </div>
      ),
    },
    { label: "Amount", render: (r) => <span className="num">{r.assetKey ? `${r.quantity} ${r.symbol}` : tx.money(r.amountCents)}{r.assetKey && <span className="adm-cell-sub">{r.fundingSource === "USD" ? tx.money(r.amountCents) : r.network}</span>}</span> },
    { label: "Method", render: (r) => r.method },
    {
      label: "Reference",
      render: (r) => (
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{r.reference}</span>
      ),
    },
    {
      label: "Details",
      render: (r) =>
        r.assetKey ? <div className="adm-wallet-block"><code style={{overflowWrap:"anywhere"}}>{r.receivingAddress}</code>
          <span className="adm-cell-sub">{r.network}</span>
          {r.destinationTag != null && <span className="adm-cell-sub">{tx("XRP destination tag")}: {r.destinationTag}</span>}
          {r.explorerUrl ? <a href={r.explorerUrl} target="_blank" rel="noreferrer noopener">{tx("View blockchain transaction ↗")}</a> : <span className="adm-cell-sub">{tx("No transfer reference attached")}</span>}
        </div> : r.details ? (
          <span title={r.details} style={{ display: "block", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.details}
          </span>
        ) : (
          "—"
        ),
    },
    {
      // For a withdrawal this is where the money goes, so it is shown as a
      // full-width verifiable address rather than a truncated string.
      label: type === "DEPOSIT" ? "From Wallet" : "Payout Wallet",
      render: (r) =>
        r.walletAddress ? (
          <div className="adm-wallet-block">
            <a
              className="adm-wallet-cell"
              href={`https://etherscan.io/address/${r.walletAddress}`}
              target="_blank"
              rel="noreferrer noopener"
              title={r.walletAddress}
            >
              {r.walletAddress}
            </a>
          </div>
        ) : (
          <span className="adm-wallet-cell none">—</span>
        ),
    },
    { label: "Status", render: (r) => <StatusPill status={r.status} /> },
    { label: "Created", render: (r) => <span style={{ whiteSpace: "nowrap" }}>{tx.date(r.createdAt)}</span> },
    {
      label: "",
      className: "num",
      render: (r) =>
        r.status === "PENDING" ? (
          <div className="adm-actions-cell">
            <button className="adm-btn good sm" onClick={() => setDecision({ row: r, action: "APPROVE", type })}>{tx("Approve")}</button>
            <button className="adm-btn danger sm" onClick={() => setDecision({ row: r, action: "REJECT", type })}>{tx("Reject")}</button>
          </div>
        ) : (
          <span className="adm-cell-sub">{tx("Reviewed")}</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tx(type === "DEPOSIT" ? "Deposit Requests" : "Withdrawal Requests")}
        subtitle={tx("Manually review each request. Approving creates the transaction and updates the ledger atomically; withdrawals already reserve funds at submission.")}
      />

      <div className="adm-inline-form">
        {userId && <p>{tx("Showing activity for the selected account.")} <a href="/admin/requests">{tx("Show all accounts")}</a></p>}
        <div className="adm-seg">
          <button className={type === "DEPOSIT" ? "active" : ""} onClick={() => switchType("DEPOSIT")}>{tx("Deposits")}</button>
          <button className={type === "WITHDRAWAL" ? "active" : ""} onClick={() => switchType("WITHDRAWAL")}>{tx("Withdrawals")}</button>
        </div>
        <select className="adm-select" value={status} onChange={(e) => switchStatus(e.target.value)}>
          <option value="ALL">{tx("All statuses")}</option>
          <option value="PENDING">{tx("Pending")}</option>
          <option value="APPROVED">{tx("Approved")}</option>
          <option value="REJECTED">{tx("Rejected")}</option>
        </select>
      </div>

      {error && currentData && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {!error && !currentData ? (
        <Spinner label={tx("Loading requests…")} />
      ) : error && !currentData ? (
        <ErrorBanner message={error} onRetry={reload} />
      ) : currentData ? (
        <>
          <DataTable columns={columns} rows={currentData.items} />
          <Pagination
            page={page}
            totalPages={currentData.totalPages}
            total={currentData.total}
            onChange={(p) => {
              setPage(p);
            }}
          />
        </>
      ) : null}

      {decision && (
        <Modal busy={!!busy} title={`${decision.action === "APPROVE" ? tx("Approve") : tx("Reject")} ${decision.type === "DEPOSIT" ? "deposit" : "withdrawal"}`} onClose={() => setDecision(null)}>
          <p className="adm-confirm-text">
            <b style={{ color: "var(--dash-text)" }}>{decision.row.userName}</b> · {decision.row.assetKey ? `${decision.row.quantity} ${decision.row.symbol}` : tx.money(decision.row.amountCents)}{" "}{tx("via")}{" "}{decision.row.method}
            <br />
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{decision.row.reference}</span>
          </p>
          <div className="adm-field">
            <label>{tx("Admin note (optional, sent to the user)")}</label>
            <textarea
              className="adm-textarea"
              placeholder={tx(decision.action === "APPROVE" ? "e.g. Deposit confirmed. Welcome aboard!" : "e.g. Please provide a valid payment proof and retry.")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {decision.row.assetKey && <div className="adm-notice"><b>{decision.row.network}</b><code style={{display:"block",overflowWrap:"anywhere"}}>{decision.row.receivingAddress}</code>
            {decision.row.destinationTag != null && <p>{tx("XRP destination tag")}: <bdi>{decision.row.destinationTag}</bdi></p>}
            {decision.row.explorerUrl && <a href={decision.row.explorerUrl} target="_blank" rel="noreferrer noopener">{tx("View blockchain transaction ↗")}</a>}
            <p>{tx(decision.type === "DEPOSIT" ? "Verify the recipient, network, asset, received quantity and confirmations before crediting this deposit." : "Send the stated crypto quantity to this address, then record the completed payout transaction. Approval records payment; it does not send funds.")}</p>
          </div>}
          {decision.row.assetKey && decision.action === "APPROVE" && <div className="adm-field"><label htmlFor="payout-hash">{tx("Transaction hash (optional)")}</label>
            <input id="payout-hash" className="adm-input" dir="ltr" value={txHash} maxLength={100} onChange={e => setTxHash(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="review-hash-hint" />
            <span id="review-hash-hint" className="adm-field-hint">{tx("Leave blank to approve without a transaction hash. Correct or clear an incorrect reference before approving.")}</span></div>}
          {decisionError && <ErrorBanner message={decisionError} />}
          <div className="adm-row-end">
            <button className="adm-btn ghost" onClick={() => setDecision(null)} disabled={busy}>{tx("Cancel")}</button>
            <button
              className={`adm-btn ${decision.action === "APPROVE" ? "good" : "danger"}`}
              onClick={submitDecision}
              disabled={busy}
            >
              {busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Working…")}</> : `${decision.action === "APPROVE" ? tx("Approve") : tx("Reject")} ${decision.row.assetKey ? `${decision.row.quantity} ${decision.row.symbol}` : tx.money(decision.row.amountCents)}`}
            </button>
          </div>
        </Modal>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
