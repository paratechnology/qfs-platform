"use client";
import type { FeedbackMessage } from "@/components/ActionFeedback";

import { useCallback, useRef, useState } from "react";
import { useText } from "@/lib/i18n/text";
import { useLive } from "@/lib/use-live";
import { apiGet, apiSend, ErrorBanner, Field, Modal, Spinner, Toast } from "./ui";
import type { FundingAsset, ReceivingWallet } from "@/lib/crypto-funds";

export default function ReceivingWallets() {
  const tx = useText();
  const [data, setData] = useState<{assets: Record<string, FundingAsset>; wallets: ReceivingWallet[]} | null>(null);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<{id?: string; assetKey: string; label: string; address: string; destinationTag: string} | null>(null);
  const [editorError, setEditorError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [toast, setToast] = useState<FeedbackMessage | null>(null);
  const load = useCallback(async () => {
    try { setData(await apiGet("/api/admin/receiving-wallets")); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useLive(load);
  function openEditor(wallet?: ReceivingWallet) {
    if (lock.current) return;
    setEditorError("");
    setEditor(wallet ? {id: wallet.id, assetKey: wallet.assetKey, label: wallet.label, address: wallet.address, destinationTag: wallet.destinationTag ?? ""} : {assetKey: "ETH", label: "", address: "", destinationTag: ""});
  }
  async function save() {
    if (!editor || lock.current) return;
    lock.current = true; setBusy(true); setEditorError("");
    try {
      const body = {label: editor.label.trim(), address: editor.address.trim(), destinationTag: editor.assetKey === "XRP" ? editor.destinationTag.trim() || null : null};
      await apiSend(editor.id ? `/api/admin/receiving-wallets/${editor.id}` : "/api/admin/receiving-wallets", editor.id ? "PATCH" : "POST", editor.id ? body : {...body, assetKey: editor.assetKey});
      setEditor(null); setToast(editor.id ? "Receiving wallet updated" : "Receiving wallet added"); await load();
    } catch (e) { setEditorError((e as Error).message); }
    finally { setBusy(false); lock.current = false; }
  }
  async function toggle(wallet: ReceivingWallet) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await apiSend(`/api/admin/receiving-wallets/${wallet.id}`, "PATCH", {isActive: !wallet.isActive}); setToast("Receiving wallet updated"); await load(); }
    catch (e) { setToast({message: (e as Error).message, tone: "error"}); }
    finally { setBusy(false); lock.current = false; }
  }
  return <section className="adm-receiving-wallets" aria-labelledby="receiving-wallets-title">
    <div className="adm-wallet-heading"><div><h2 id="receiving-wallets-title">{tx("Receiving wallets")}</h2>
      <p>{tx("Deposits go to these addresses. Existing deposit instructions keep their saved address.")}</p></div>
      <button className="adm-btn primary" disabled={!data || busy} onClick={() => openEditor()}>{tx("Add receiving wallet")}</button></div>
    {error && <ErrorBanner message={error} onRetry={load} />}
    {!data && !error && <Spinner label={tx("Loading receiving wallets…")} />}
    {data?.wallets.length === 0 && <p className="adm-notice">{tx("Add a receiving wallet to enable crypto deposits.")}</p>}
    {data?.wallets.map(wallet => <div className="adm-receiving-row adm-wallet-row" key={wallet.id} data-wallet-id={wallet.id}>
      <div className="adm-wallet-info"><strong>{wallet.label}</strong><span className="adm-cell-sub">{data.assets[wallet.assetKey]?.symbol} · {data.assets[wallet.assetKey]?.network}</span>
        <code dir="ltr">{wallet.address}</code>
        {wallet.destinationTag != null && <span className="adm-cell-sub">{tx("XRP destination tag")}: <bdi>{wallet.destinationTag}</bdi></span>}</div>
      <div className="adm-wallet-actions"><button className="adm-btn ghost" disabled={busy} onClick={() => openEditor(wallet)} aria-label={tx("Edit {value0}", {value0: wallet.label})}>{tx("Edit")}</button>
      <button className={`adm-btn ${wallet.isActive ? "ghost" : "primary"}`} disabled={busy} onClick={() => toggle(wallet)}>{tx(wallet.isActive ? "Disable" : "Enable")}</button>
      </div>
    </div>)}
    {editor && <Modal busy={busy} title={tx(editor.id ? "Edit receiving wallet" : "Add receiving wallet")} onClose={() => {if (!lock.current) setEditor(null);}}>
      {editorError && <ErrorBanner message={editorError} />}
      <Field label={tx("Asset and network")}><select className="adm-select" aria-label={tx("Asset and network")} disabled={!!editor.id} value={editor.assetKey} onChange={e => setEditor({...editor, assetKey:e.target.value, address:"", destinationTag:""})}>
        {Object.entries(data?.assets ?? {}).map(([key, asset]) => <option value={key} key={key}>{asset.symbol} · {asset.network}</option>)}</select></Field>
      <Field label={tx("Wallet label")}><input className="adm-input" aria-label={tx("Wallet label")} value={editor.label} maxLength={80} onChange={e => setEditor({...editor, label:e.target.value})} /></Field>
      <Field label={tx("Receiving address")}><input className="adm-input" aria-label={tx("Receiving address")} dir="ltr" autoComplete="off" spellCheck={false} value={editor.address} onChange={e => setEditor({...editor, address:e.target.value})} /></Field>
      {editor.assetKey === "XRP" && <Field label={tx("XRP destination tag")}><input className="adm-input" aria-label={tx("XRP destination tag")} dir="ltr" inputMode="numeric" maxLength={10} value={editor.destinationTag} onChange={e => setEditor({...editor, destinationTag:e.target.value})}/></Field>}
      <p className="adm-notice">{tx("Check the asset, network and full address before enabling deposits.")}</p>
      <div className="adm-row-end"><button className="adm-btn ghost" disabled={busy} onClick={() => setEditor(null)}>{tx("Cancel")}</button>
        <button className="adm-btn primary" disabled={busy || !editor.address.trim() || editor.label.trim().length < 2} onClick={save}>{busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Saving…")}</> : tx(editor.id ? "Save Changes" : "Add receiving wallet")}</button></div>
    </Modal>}
    <Toast message={toast} onDone={() => setToast(null)} />
  </section>;
}
