"use client";

import { useCallback, useState } from "react";
import { useText } from "@/lib/i18n/text";
import { useLive } from "@/lib/use-live";
import type { FundingAsset, ReceivingWallet } from "@/lib/crypto-funds";
import { apiGet, apiSend, ErrorBanner, Field, Modal, Spinner, Toast } from "./ui";

type Route = {assetKey: string; walletId: string; providerTicker: string; isActive: boolean};
type Configuration = {enabled: boolean; credentialsConfigured: boolean; providerAvailable: boolean; automaticFunding: boolean;
  assets: Record<string, FundingAsset>; wallets: ReceivingWallet[]; routes: Route[]; currencies: {assetKey: string; ticker: string; enabled: boolean}[]};

export default function SwapConfiguration() {
  const tx = useText();
  const [data, setData] = useState<Configuration | null>(null);
  const [editor, setEditor] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const load = useCallback(async () => { try {setData(await apiGet("/api/admin/swaps/configuration")); setError("");} catch(e) {setError((e as Error).message);} }, []);
  useLive(load, 30_000);
  async function save() {
    if (!editor || busy) return;
    setBusy(true); setError("");
    try {await apiSend("/api/admin/swaps/configuration", "PUT", editor); setEditor(null); setToast("Swap configuration saved"); await load();}
    catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }
  return <section className="adm-receiving-wallets" aria-labelledby="swap-config-title">
    <div className="adm-wallet-heading"><div><h2 id="swap-config-title">{tx("Crypto swaps")}</h2><p>{tx("Map supported exchange assets to your treasury receiving wallets.")}</p></div><a href="/admin/swaps" className="adm-btn ghost">{tx("Manage swaps")}</a></div>
    {error && !editor && <ErrorBanner message={error} onRetry={load}/>}
    {!data && !error && <Spinner/>}
    {data && <>
      <p className="adm-notice">{tx(!data.credentialsConfigured ? "Configure Changelly credentials on the server to connect the exchange provider." : !data.providerAvailable ? "The exchange provider is unavailable. Please try again shortly." : !data.enabled ? "The provider is connected. Enable swaps on the server after configuring treasury routes." : "Exchange provider connected.")}</p>
      <p className="adm-cell-sub">{tx(data.automaticFunding ? "Automatic treasury funding is configured." : "Treasury payments require an administrator to send funds and record the transaction.")}</p>
      <div className="adm-swap-routes">{Object.entries(data.assets).map(([assetKey, asset]) => {
        const route = data.routes.find(row => row.assetKey === assetKey);
        const wallet = data.wallets.find(row => row.id === route?.walletId);
        const provider = data.currencies.find(row => row.assetKey === assetKey && row.enabled);
        return <div className="adm-receiving-row" key={assetKey}><div><strong>{asset.symbol}</strong><span className="adm-cell-sub">{asset.network}</span><span className="adm-cell-sub">{wallet?.label ?? tx("No treasury route configured")}</span></div>
          <span>{tx(route?.isActive && wallet ? "Enabled" : "Disabled")}</span>
          <button className="adm-btn ghost" disabled={!provider && !route} onClick={() => {setError(""); setEditor(route ?? {assetKey, providerTicker:provider?.ticker ?? "", walletId:data.wallets.find(row => row.assetKey === assetKey)?.id ?? "", isActive:true});}}>{tx("Configure")}</button></div>;
      })}</div>
    </>}
    {editor && <Modal busy={!!busy} title={tx("Configure swap asset")} onClose={() => {if(!busy)setEditor(null);}}>
      {error && <ErrorBanner message={error}/>}
      <fieldset className="dash-form-fieldset" disabled={busy}>
        <Field label={tx("Asset and network")}><strong>{data?.assets[editor.assetKey]?.symbol} · {data?.assets[editor.assetKey]?.network}</strong></Field>
        <Field label={tx("Provider asset")}><select className="adm-select" value={editor.providerTicker} onChange={e => setEditor({...editor, providerTicker:e.target.value})}>
          <option value="" disabled>{tx("Select")}</option>{data?.currencies.filter(row => row.assetKey === editor.assetKey).map(row => <option key={row.ticker} value={row.ticker} disabled={!row.enabled}>{row.ticker}</option>)}
          {!data?.currencies.some(row => row.ticker === editor.providerTicker) && editor.providerTicker && <option value={editor.providerTicker}>{editor.providerTicker}</option>}
        </select></Field>
        <Field label={tx("Receiving wallets")}><select className="adm-select" value={editor.walletId} onChange={e => setEditor({...editor, walletId:e.target.value})}>
          <option value="" disabled>{tx("Select")}</option>{data?.wallets.filter(wallet => wallet.assetKey === editor.assetKey).map(wallet => <option value={wallet.id} key={wallet.id}>{wallet.label} · {wallet.address}</option>)}
        </select></Field>
        <label className="adm-swap-check"><input type="checkbox" checked={editor.isActive} onChange={e => setEditor({...editor, isActive:e.target.checked})}/>{tx("Enable this swap asset")}</label>
      </fieldset>
      <p className="adm-notice">{tx("Use wallets controlled by the platform. The source wallet also receives any exchange refund.")}</p>
      <div className="adm-row-end"><button className="adm-btn ghost" disabled={busy} onClick={() => setEditor(null)}>{tx("Cancel")}</button><button className="adm-btn primary" disabled={busy || !editor.walletId || !editor.providerTicker} onClick={save}>{tx(busy ? "Saving…" : "Save")}</button></div>
    </Modal>}
    <Toast message={toast} onDone={() => setToast(null)} />
  </section>;
}

