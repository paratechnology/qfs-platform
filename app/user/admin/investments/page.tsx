"use client";
import { useText } from "@/lib/i18n/text";


import { useRef, useState } from "react";
import { apiSend, DataTable, ErrorBanner, Modal, PageHeader, Spinner, StatusPill, useFetch, fmtDate, fmtMoney, type Column } from "@/components/admin/ui";

type Investment = { id: string; userName: string; userEmail: string; planName: string; amountCents: number; paidOutCents: number; status: string; maturedAt: string | null; principalRelease: string };

export default function AdminInvestmentsPage() {
  const tx = useText();
  const { data, loading, error, reload } = useFetch<Investment[]>("/api/admin/investments");
  const [selected, setSelected] = useState<Investment | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  const submitting = useRef(false);

  async function release() {
    if (!selected || submitting.current) return;
    submitting.current = true; setBusy(true); setFailure("");
    try {
      const result = await apiSend<{ released: boolean }>(`/api/admin/investments/${selected.id}`, "PATCH", { action: "RELEASE_PRINCIPAL" });
      setSuccess(result.released ? `${tx.money(selected.amountCents)} principal released to ${selected.userName}’s available balance.` : "Principal was already released. No duplicate return was made.");
      setSelected(null); await reload();
    } catch (e) { setFailure((e as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  const columns: Column<Investment>[] = [
    { label: "Account", render: (item) => <div><strong>{item.userName}</strong><small style={{ display: "block", color: "var(--dash-muted)" }}>{item.userEmail}</small></div> },
    { label: "Plan", render: (item) => item.planName },
    { label: "Principal", render: (item) => tx.money(item.amountCents) },
    { label: "Profit paid", render: (item) => tx.money(item.paidOutCents) },
    { label: "Term completed", render: (item) => item.maturedAt ? tx.date(item.maturedAt) : "Not recorded" },
    { label: "Action", render: (item) => <button className="adm-btn ghost sm" onClick={() => { setSelected(item); setFailure(""); setSuccess(""); }}>{tx("Review release")}</button> },
  ];
  return <>
    <PageHeader title={tx("Principal releases")} subtitle={tx("Completed investment terms awaiting return of original principal.")} />
    {success && <p className="adm-banner" role="status">{tx(success)}</p>}
    {error && <ErrorBanner message={error} onRetry={reload} />}
    {loading && !data ? <Spinner label={tx("Loading matured investments…")} /> : data && <DataTable columns={columns} rows={data} />}
    {selected && <Modal busy={!!busy} title={tx("Release investment principal")} onClose={() => !busy && setSelected(null)}>
      <StatusPill status={selected.status} />
      <dl className="adm-kyc-details">{Object.entries({ Account: `${selected.userName} · ${selected.userEmail}`, Plan: selected.planName, Reference: selected.id, Principal: tx.money(selected.amountCents), "Profit paid": tx.money(selected.paidOutCents), "Term completed": selected.maturedAt ? tx.date(selected.maturedAt) : "Not recorded" }).map(([label, value]) => <div key={label}><dt>{tx(label)}</dt><dd>{value}</dd></div>)}</dl>
      <p className="adm-note">{tx("This restores the original principal to available balance. Total balance remains unchanged because it already includes invested capital. Profit was settled separately.")}</p>
      {failure && <ErrorBanner message={failure} />}
      <div className="adm-modal-actions"><button className="adm-btn ghost" disabled={busy} onClick={() => setSelected(null)}>{tx("Cancel")}</button><button className="adm-btn primary" disabled={busy} onClick={() => void release()}>{busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Releasing principal…")}</> : tx("Release {value0}", { value0: tx.money(selected.amountCents) })}</button></div>
    </Modal>}
  </>;
}
