"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useText } from "@/lib/i18n/text";
import { useLive } from "@/lib/use-live";
import type { CryptoSwap } from "@/lib/crypto-funds";
import { cryptoQuantity, swapStatus } from "@/lib/crypto-funds";
import { apiGet, apiSend, ErrorBanner, Field, Modal, PageHeader, Spinner, Toast } from "@/components/admin/ui";

type AdminSwap = CryptoSwap & {userEmail: string; userName: string; providerId: string | null; providerStatus: string | null;
  payinAddress: string | null; payinTag: string | null; payinHash: string | null; refundHash: string | null; refundUrl: string | null;
  payTill: string | null; fundingAttemptAt: string | null; lastError: string | null; lastCheckedAt: string | null;
  routing: {from: {address: string; tag: string | null}; to: {address: string; tag: string | null}}};

export default function AdminSwaps() {
  const tx = useText();
  const [data, setData] = useState<{items: AdminSwap[]; automaticFunding: boolean} | null>(null);
  const [selected, setSelected] = useState<AdminSwap | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  const [providerId, setProviderId] = useState("");
  const [refundQuantity, setRefundQuantity] = useState("");
  const [verified, setVerified] = useState(false);
  const lock = useRef(false);
  const load = useCallback(async () => {try {setData(await apiGet("/api/admin/swaps" + (pending ? "?pending=1" : "")));} catch(e) {setError((e as Error).message);}}, [pending]);
  useLive(load, 15_000, false);
  useEffect(() => {void load();}, [load]);
  async function act(action: string) {
    if (!selected || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await apiSend<AdminSwap>(`/api/admin/swaps/${selected.id}`, "POST", {action, txHash:hash || null, providerId:providerId || null, quantity:cryptoQuantity(refundQuantity, tx.locale), verified});
      setSelected({...selected, ...result}); setHash(""); setVerified(false); await load();
      setMessage("Swap status updated. Review the latest exchange details before taking another action.");
    } catch(e) {setError((e as Error).message);}
    finally {setBusy(false); lock.current = false;}
  }
  const terminal = selected && ["COMPLETED", "CANCELLED", "REFUNDED"].includes(selected.status);
  return <div>
    <PageHeader title={tx("Crypto swaps")} subtitle={tx("Track exchange execution, treasury funding and settlement.")} actions={<a href="/admin/settings#swap-config-title" className="adm-btn ghost">{tx("Configure swaps")}</a>}/>
    <label className="adm-swap-check"><input type="checkbox" checked={pending} onChange={e => setPending(e.target.checked)}/>{tx("Pending swaps only")}</label>
    {error && !selected && <ErrorBanner message={error} onRetry={load}/>}
    {!data && !error && <Spinner/>}
    {data?.items.length === 0 && <p className="adm-notice">{tx("No swaps to display.")}</p>}
    {data?.items.map(row => <button className="adm-swap-row" key={row.id} onClick={() => {setSelected(row); setHash(""); setProviderId(""); setRefundQuantity(""); setVerified(false); setError("");}}>
      <span><strong>{row.userEmail}</strong><small>{tx.date(row.createdAt, {hour:"2-digit", minute:"2-digit"})}</small></span>
      <span><bdi>{row.quantity} {row.fromSymbol} → {row.receivedQuantity ?? row.quotedQuantity} {row.toSymbol}</bdi><small>{row.fromNetwork} → {row.toNetwork}</small></span>
      <span className="adm-pill">{tx(swapStatus(row.status))}</span>
    </button>)}
    {selected && <Modal busy={!!busy} title={tx("Swap details")} wide onClose={() => {if(!busy)setSelected(null);}}>
      {error && <ErrorBanner message={error}/>}
      <p><strong dir="ltr">{selected.quantity} {selected.fromSymbol} → {selected.receivedQuantity ?? selected.quotedQuantity} {selected.toSymbol}</strong></p>
      <p>{tx(swapStatus(selected.status))} · {selected.userEmail}</p>
      <dl className="adm-swap-details"><div><dt>{tx("Reference")}</dt><dd><code>{selected.reference}</code></dd></div>
        <div><dt>{tx("Provider order")}</dt><dd><code>{selected.providerId ?? "—"}</code></dd></div>
        <div><dt>{tx("Source treasury")}</dt><dd><code>{selected.routing.from.address}</code></dd></div>
        <div><dt>{tx("Destination treasury")}</dt><dd><code>{selected.routing.to.address}</code>{selected.routing.to.tag != null && <span>{tx("XRP destination tag")}: {selected.routing.to.tag}</span>}</dd></div>
        {selected.payinAddress && <div><dt>{tx("Exchange receiving address")}</dt><dd><code>{selected.payinAddress}</code><span>{selected.fromNetwork}</span>{selected.payinTag != null && <strong>{tx("XRP destination tag")}: {selected.payinTag}</strong>}</dd></div>}
        {selected.payTill && <div><dt>{tx("Send before")}</dt><dd>{tx.date(selected.payTill, {hour:"2-digit", minute:"2-digit", second:"2-digit"})}</dd></div>}
        {selected.payinHash && <div><dt>{tx("Funding transaction")}</dt><dd><code>{selected.payinHash}</code></dd></div>}
      </dl>
      {selected.lastError && <p className="adm-notice" role="status">{tx(selected.lastError)}</p>}
      {selected.payoutUrl && <p><a href={selected.payoutUrl} target="_blank" rel="noreferrer">{tx("View blockchain transaction ↗")}</a></p>}
      {selected.refundUrl && <p><a href={selected.refundUrl} target="_blank" rel="noreferrer">{tx("View refund transaction ↗")}</a></p>}
      {!terminal && <>
        <button className="adm-btn ghost" disabled={busy} onClick={() => act("REFRESH")}>{tx(busy ? "Working…" : "Refresh provider status")}</button>
        {!selected.providerId && <><Field label={tx("Recover provider order ID")}><input className="adm-input" value={providerId} onChange={e => setProviderId(e.target.value)} disabled={busy}/></Field><button className="adm-btn primary" disabled={busy || !providerId} onClick={() => act("RECOVER")}>{tx("Verify and recover order")}</button></>}
        {selected.status === "AWAITING_FUNDING" && !data?.automaticFunding && <><p className="adm-notice">{tx("Begin funding before sending. Send the exact quantity to the exchange address and include its destination tag when shown.")}</p><button className="adm-btn primary" disabled={busy} onClick={() => act("BEGIN_FUNDING")}>{tx("Begin treasury funding")}</button></>}
        {selected.fundingAttemptAt && !selected.payinHash && <><p className="adm-notice">{tx("Check the treasury wallet for an existing payment before sending again.")}</p><Field label={tx("Funding transaction")}><input className="adm-input" dir="ltr" value={hash} onChange={e => setHash(e.target.value)} disabled={busy}/></Field><button className="adm-btn primary" disabled={busy || !hash} onClick={() => act("RECORD_FUNDING")}>{tx("Record funding transaction")}</button></>}
        {selected.providerStatus === "refunded" && <><Field label={tx("Verified refund quantity")}><input className="adm-input" inputMode="decimal" value={refundQuantity} onChange={e => setRefundQuantity(e.target.value)} disabled={busy}/></Field><label className="adm-swap-check"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} disabled={busy}/>{tx("I verified the refund address, transaction and received quantity on the source network.")}</label><button className="adm-btn primary" disabled={busy || !verified || !refundQuantity} onClick={() => act("REFUND")}>{tx("Record verified refund")}</button></>}
        {selected.providerStatus === "expired" && !selected.payinHash && !data?.automaticFunding && <><label className="adm-swap-check"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} disabled={busy}/>{tx("I checked the treasury wallet and verified that no payment was sent for this expired order.")}</label><button className="adm-btn ghost" disabled={busy || !verified} onClick={() => act("RELEASE_UNFUNDED")}>{tx("Release unfunded reservation")}</button></>}
      </>}
    </Modal>}
    <Toast message={message} onDone={() => setMessage(null)} />
  </div>;
}
