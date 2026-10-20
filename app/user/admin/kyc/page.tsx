"use client";
import { useText } from "@/lib/i18n/text";
import { ActionNotice } from "@/components/ActionFeedback";


import { useRef, useState } from "react";
import KycHistory from "@/components/dashboard/KycHistory";
import type { KycRecord, KycStatus } from "@/lib/api-types";
import { apiGet, apiSend, DataTable, ErrorBanner, Field, Modal, PageHeader, Pagination, Spinner, StatusPill, useFetch, type Column } from "@/components/admin/ui";

type Submission = { id: string; userName: string; email: string; status: KycStatus; submittedAt: string; reviewedAt: string | null; version: number };
const fileLabels: Record<string, string> = { IDENTITY_FRONT: "Identity document — front / passport page", IDENTITY_BACK: "Identity document — back", PORTRAIT: "Face photo" };

export default function AdminKycPage() {
  const tx = useText();
  const [filter, setFilter] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const { data, error, loading, reload } = useFetch<{items: Submission[]; total: number; page: number; totalPages: number}>(`/api/admin/kyc?status=${filter}&page=${page}&search=${encodeURIComponent(search)}`);
  const reviewGeneration = useRef(0);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [record, setRecord] = useState<KycRecord | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function open(submission: Submission) {
    const current = ++reviewGeneration.current;
    setSelected(submission); setRecord(null); setNote(""); setChecked(false); setReviewError(""); setReviewLoading(true); setMessage("");
    try { const result = await apiGet<KycRecord>(`/api/admin/kyc/${submission.id}`); if (current === reviewGeneration.current) setRecord(result); }
    catch (e) { if (current === reviewGeneration.current) setReviewError((e as Error).message); }
    finally { if (current === reviewGeneration.current) setReviewLoading(false); }
  }
  async function decide(action: "APPROVE" | "REQUEST_CHANGES" | "REVERIFY") {
    if (!record || !selected || busy) return;
    setBusy(true); setReviewError(""); setMessage("");
    try {
      const result = await apiSend<KycRecord>(`/api/admin/kyc/${selected.id}`, "PATCH", { action, version: record.version, note: note.trim() || undefined });
      setRecord(result); await reload();
      setMessage("Verification review completed. The user has been notified.");
    } catch (e) { setReviewError((e as Error).message); }
    finally { setBusy(false); }
  }
  const columns: Column<Submission>[] = [
    { label: "Account", render: (item) => <div><strong>{item.userName}</strong><small style={{ display: "block", color: "var(--dash-muted)" }}>{item.email}</small></div> },
    { label: "Status", render: (item) => <StatusPill status={item.status} /> },
    { label: "Submitted", render: (item) => tx.date(item.submittedAt) },
    { label: "Actions", render: (item) => <button className="adm-btn ghost sm" onClick={() => void open(item)}>{tx(item.status === "PENDING" ? "Review submission" : "View review")}</button> },
  ];
  return <>
    <PageHeader title={tx("Identity verification")} subtitle={tx("Private document review. Approvals update the account’s verification status.")} />
    <form className="adm-toolbar" onSubmit={e => {e.preventDefault(); setSearch(searchInput.trim()); setPage(1);}}><select className="adm-input" aria-label={tx("Verification status filter")} value={filter} onChange={(e) => {setFilter(e.target.value);setPage(1);}}><option value="PENDING">{tx("Pending review")}</option><option value="NEEDS_CHANGES">{tx("Changes requested")}</option><option value="APPROVED">{tx("Approved")}</option><option value="ALL">{tx("All submissions")}</option></select><input className="adm-input" aria-label={tx("Search name or email")} placeholder={tx("Search name or email")} maxLength={200} value={searchInput} onChange={e => setSearchInput(e.target.value)} /><button className="adm-btn ghost" type="submit">{tx("Search")}</button></form>
    {error && <ErrorBanner message={error} onRetry={reload} />}
    {loading && !data ? <Spinner label={tx("Loading submissions…")} /> : data && <><DataTable columns={columns} rows={data.items} /><Pagination page={data.page} total={data.total} totalPages={data.totalPages} onChange={setPage} /></>}
    {selected && <Modal busy={!!busy} title={tx("Verification — {value0}", { value0: selected.userName })} onClose={() => {if (!busy) {reviewGeneration.current++;setSelected(null);}}} wide>
      {reviewLoading && <Spinner label={tx("Loading private documents…")} />}
      {reviewError && <ErrorBanner message={reviewError} onRetry={() => void open(selected)} />}
      {message && <ActionNotice message={message} />}
      {record && <>
        <StatusPill status={record.status} />
        <dl className="adm-kyc-details">{Object.entries({ "Legal name": record.details.legalName, "Date of birth": record.details.dateOfBirth, "Country of residence": record.details.country, "Residential address": record.details.address, "Document type": record.details.documentType?.replaceAll("_", " "), "Submitted": record.submittedAt ? tx.date(record.submittedAt) : "—" }).map(([label, value]) => <div key={label}><dt>{tx(label)}</dt><dd>{value}</dd></div>)}</dl>
        <h3 style={{ fontSize: 14 }}>{tx("Documents")}</h3>
        <ul className="adm-kyc-files">{record.files.map((file) => <li key={file.id}><a className="adm-btn ghost" href={file.url} target="_blank" rel="noreferrer">{tx("Download {value0}", { value0: fileLabels[file.kind] ?? file.kind })}</a><small>{Math.ceil(file.size / 1024)} KB</small></li>)}</ul>
        {record.reviewNote && <p className="adm-banner">{record.reviewNote}</p>}
        {record.status === "PENDING" ? <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
          <Field label={tx("Review note (required when requesting changes)")}><textarea className="adm-textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <label className="adm-check" style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.7, margin: "20px 0" }}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{tx("I have reviewed the identity document, face photo, and submitted details.")}</label>
          <div className="adm-modal-actions"><button className="adm-btn ghost" disabled={note.trim().length < 3 || busy} onClick={() => void decide("REQUEST_CHANGES")}>{tx("Request changes")}</button><button className="adm-btn primary" disabled={!checked || busy} onClick={() => void decide("APPROVE")}>{tx(busy ? "Saving decision…" : "Approve identity")}</button></div>
        </fieldset> : <><p className="adm-banner">{tx(record.status === "APPROVED" ? "Approved. The account is verified." : "Changes requested. The user can update and resubmit their documents.")}</p>{record.status === "APPROVED" && <details><summary>{tx("Request reverification")}</summary><p>{tx("This removes verified status and asks the user to update and resubmit. Enter the reason below.")}</p><label><span>{tx("Reason for reverification")}</span><textarea className="adm-textarea" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} disabled={busy} /></label><button className="adm-btn ghost" disabled={busy || note.trim().length < 3} onClick={() => void decide("REVERIFY")}>{tx(busy ? "Saving decision…" : "Request reverification")}</button></details>}</>}
        <KycHistory submissionId={selected.id} revision={record.version} />
      </>}
    </Modal>}
  </>;
}
