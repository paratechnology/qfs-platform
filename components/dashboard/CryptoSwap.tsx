"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useText } from "@/lib/i18n/text";
import { useLive } from "@/lib/use-live";
import { cryptoQuantity, formatCryptoQuantity, fundingRequest, FundingError, swapStatus, type TransactionState, type CryptoSwap as SwapResult, type FundingSnapshot, type SwapQuote, type SwapSnapshot } from "@/lib/crypto-funds";
import { Spinner } from "./feedback";
import { SwapVert } from "./icons";

export default function CryptoSwap({funds, refreshFunds, onChanged, onBusy, onStateChange}: {
  funds: FundingSnapshot | null; refreshFunds: () => Promise<void>; onChanged: () => unknown; onBusy: (value: boolean) => void; onStateChange?: (state: TransactionState) => void;
}) {
  const tx = useText();
  const [data, setData] = useState<SwapSnapshot | null>(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [needsFunds, setNeedsFunds] = useState(false);
  useEffect(() => { onStateChange?.(submitted ? "submitted" : needsFunds ? "insufficient" : "form"); }, [submitted, needsFunds, onStateChange]);
  const [resultStatus, setResultStatus] = useState("");
  const [now, setNow] = useState(Date.now());
  const reference = useRef("");
  const lock = useRef(false);
  const quantityLocale = useRef(tx.locale);
  const latestItems = useRef("");
  const clearAttempt = useCallback(() => {
    try { sessionStorage.removeItem("qfs.swap.attempt"); } catch { /* Optional recovery storage. */ }
    reference.current = ""; setUncertain(false);
  }, []);
  const load = useCallback(async () => {
    const result = await fundingRequest<SwapSnapshot>("/api/wallet/swaps");
    setData(result);
    const fingerprint = result.items.map(item => item.id + item.status).join(",");
    if (latestItems.current && latestItems.current !== fingerprint) { void refreshFunds(); void onChanged(); }
    latestItems.current = fingerprint;
    if (reference.current && result.items.some(item => item.reference === reference.current)) {
      setResultStatus(result.items.find(item => item.reference === reference.current)!.status);
      clearAttempt(); setQuote(null); setSubmitted(true);
    }
    return result;
  }, [refreshFunds, onChanged, clearAttempt]);
  useLive(() => load().catch(e => setError((e as Error).message)), 10_000);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("qfs.swap.attempt") ?? "null") as {quote: SwapQuote; reference: string} | null;
      if (saved?.quote?.id && saved.reference) {
        reference.current = saved.reference; setQuote(saved.quote); setFrom(saved.quote.fromAsset); setTo(saved.quote.toAsset);
        setQuantity(formatCryptoQuantity(saved.quote.quantity, tx.locale)); setUncertain(true);
      }
    } catch { /* The backend history remains authoritative. */ }
  // Restore once; locale changes are handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!data || from || quote) return;
    const source = data.assets.find(item => item.from && funds?.holdings.some(asset => asset.assetKey === item.assetKey && asset.availableAtomic !== "0")) ?? data.assets.find(item => item.from);
    if (source) {setFrom(source.assetKey); setTo(data.assets.find(item => item.to && item.assetKey !== source.assetKey)?.assetKey ?? "");}
  }, [data, funds, from, quote]);
  useEffect(() => {
    if (quantityLocale.current === tx.locale) return;
    const normalized = cryptoQuantity(quantity, quantityLocale.current);
    quantityLocale.current = tx.locale;
    if (normalized) setQuantity(formatCryptoQuantity(normalized, tx.locale));
  }, [quantity, tx.locale]);
  useEffect(() => {
    if (!quote) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);
  useEffect(() => { setNeedsFunds(false); setError(""); }, [from, to, quantity]);
  const source = funds?.holdings.find(item => item.assetKey === from);
  const destination = funds?.holdings.find(item => item.assetKey === to);
  const seconds = quote ? Math.max(0, Math.floor((Date.parse(quote.expiresAt) - now) / 1000)) : 0;
  const assetLabel = (key: string) => { const item = funds?.holdings.find(asset => asset.assetKey === key); return item ? `${item.symbol} · ${item.network}` : key; };
  async function submit() {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(""); setNeedsFunds(false); setSubmitted(false);
    try {
      if (!quote) {
        const normalized = cryptoQuantity(quantity, tx.locale);
        if (!normalized) throw new Error(tx("Enter a crypto quantity without thousands separators."));
        const result = await fundingRequest<SwapQuote>("/api/wallet/swaps/quote", "POST", {fromAsset:from, toAsset:to, quantity:normalized});
        setNow(Date.now()); setQuote(result);
      } else {
        if (!reference.current) reference.current = `SWAP-${crypto.randomUUID()}`;
        try {sessionStorage.setItem("qfs.swap.attempt", JSON.stringify({quote, reference:reference.current}));} catch { /* History can recover completed requests. */ }
        setUncertain(true);
        const result = await fundingRequest<SwapResult>("/api/wallet/swaps", "POST", {quoteId:quote.id, reference:reference.current});
        setResultStatus(result.status);
        clearAttempt(); setQuote(null); setQuantity(""); setSubmitted(true);
        await Promise.all([load(), refreshFunds()]); void onChanged();
      }
    } catch (e) {
      setError((e as Error).message);
      setNeedsFunds(e instanceof FundingError && e.code === "INSUFFICIENT_FUNDS");
      if (e instanceof FundingError && [400, 401, 403, 409, 503].includes(e.status)) {
        clearAttempt();
        if (e.code === "QUOTE_EXPIRED" || e.code === "SWAP_PAIR") setQuote(null);
      }
    } finally { setBusy(false); onBusy(false); lock.current = false; }
  }
  return <div className="dash-modal-body fund-form swap-form">
    <p className="dash-input-note">{tx("Exchange available crypto. Your USD investments keep their existing terms.")}</p>
    {error && <div className="fund-error" role="alert">{tx(error)} <button className="dash-btn ghost" disabled={busy} onClick={() => {setError(""); setNeedsFunds(false); void load().catch(e => setError((e as Error).message));}}>{tx("Retry")}</button></div>}
    {!data && !error && <p role="status"><Spinner/> {tx("Loading swaps…")}</p>}
    {submitted && <div className="fund-confirmation" role="status"><strong>{tx(resultStatus === "CANCELLED" ? "Swap cancelled" : resultStatus === "COMPLETED" ? "Swap completed" : resultStatus === "REFUNDED" ? "Swap refunded" : "Swap submitted")}</strong><p>{tx(resultStatus === "CANCELLED" ? "Your crypto remains available. Request a fresh quote to try again." : resultStatus === "COMPLETED" ? "Your exchanged crypto is now available." : resultStatus === "REFUNDED" ? "The returned crypto is available in your balance." : "Your source crypto is reserved. The exchanged crypto becomes available after settlement.")}</p></div>}
    {uncertain && <p className="dash-notice" role="status">{tx("Checking a previous swap request. Retry with the same reference to avoid a duplicate exchange.")}</p>}
    {data && !data.available && !uncertain && <p className="dash-notice">{tx("Crypto swaps are not available yet.")}</p>}
    {submitted && data?.available && <button className="dash-btn ghost block" disabled={busy} onClick={() => setSubmitted(false)}>{tx("Swap again")}</button>}
    {!submitted && (data?.available || quote) && <>
      <fieldset className="dash-form-fieldset" disabled={busy || !!quote}>
        <div className="dash-form-group"><label htmlFor="swap-from">{tx("Swap from")}</label><select id="swap-from" className="dash-select" value={from} onChange={e => {setFrom(e.target.value); setQuantity(""); setSubmitted(false); if(e.target.value === to) setTo(data?.assets.find(item => item.to && item.assetKey !== e.target.value)?.assetKey ?? "");}}>
          {quote ? <option value={from}>{assetLabel(from)}</option> : data?.assets.filter(item => item.from).map(item => <option value={item.assetKey} key={item.assetKey}>{assetLabel(item.assetKey)}</option>)}</select></div>
        <div className="dash-form-group"><label htmlFor="swap-quantity">{tx("Crypto quantity")}</label><input id="swap-quantity" className="dash-input" dir="ltr" inputMode="decimal" value={quantity} onChange={e => {setQuantity(e.target.value); setSubmitted(false);}}/></div>
        <p className="dash-input-note">{tx("Available")}: <bdi>{source?.available ?? "—"} {source?.symbol}</bdi></p>
        <div className="swap-direction" aria-hidden="true"><SwapVert size={18}/></div>
        <div className="dash-form-group"><label htmlFor="swap-to">{tx("Receive")}</label><select id="swap-to" className="dash-select" value={to} onChange={e => setTo(e.target.value)}>
          {quote ? <option value={to}>{assetLabel(to)}</option> : data?.assets.filter(item => item.to && item.assetKey !== from).map(item => <option value={item.assetKey} key={item.assetKey}>{assetLabel(item.assetKey)}</option>)}</select></div>
      </fieldset>
      {quote && <div className="fund-quote swap-quote">
        <span>{tx("You receive")}</span><strong dir="ltr">{formatCryptoQuantity(quote.receiveQuantity, tx.locale)} {destination?.symbol ?? to}</strong>
        <span>{destination?.network}</span>
        <dl><div><dt>{tx("Network fee included")}</dt><dd dir="ltr">{formatCryptoQuantity(quote.networkFee, tx.locale)} {destination?.symbol ?? to}</dd></div>
          <div><dt>{tx("Quote expires in")}</dt><dd>{tx("{seconds}s", {seconds:tx.number(seconds)})}</dd></div></dl>
        <p className="dash-input-note">{tx("The quoted amount includes exchange and destination network fees. Treasury sending fees are covered by the platform.")}</p>
      </div>}
      <button className="dash-btn primary block" disabled={busy || !funds || (!uncertain && (!data?.available || !quantity || !from || !to || from === to || (!!quote && seconds === 0)))} onClick={submit}>{busy ? <><Spinner/>{tx("Working…")}</> : tx(uncertain ? "Check swap request" : quote ? "Confirm swap" : "Review swap")}</button>
      {quote && !uncertain && <button className="dash-btn ghost block" disabled={busy} onClick={() => {setQuote(null); setError(""); reference.current = "";}}>{tx("Edit or refresh quote")}</button>}
    </>}
    {!!data?.items.length && <section className="swap-history" aria-labelledby="swap-history-title"><h3 id="swap-history-title">{tx("Swap history")}</h3>
      {data.items.map(item => <div className="fund-activity-row" key={item.id}><div><strong dir="ltr">{item.quantity} {item.fromSymbol} → {item.status === "REFUNDED" ? `${item.refundQuantity} ${item.fromSymbol}` : `${item.receivedQuantity ?? item.quotedQuantity} ${item.toSymbol}`}</strong><span>{item.fromNetwork} → {item.toNetwork}</span>
        {item.status !== "COMPLETED" && item.status !== "REFUNDED" && <small>{tx("Quoted output; settlement is not complete.")}</small>}
        <span>{tx.date(item.createdAt, {hour:"2-digit", minute:"2-digit"})}</span><small>{item.reference}</small>
        {item.payoutUrl && <a href={item.payoutUrl} target="_blank" rel="noreferrer">{tx("View blockchain transaction ↗")}</a>}</div>
        <div><span className="dash-tx-status" data-status={item.status.toLowerCase()}>{tx(swapStatus(item.status))}</span>{item.status === "NEEDS_REVIEW" && <small>{tx("Funds remain reserved during review.")}</small>}</div></div>)}
    </section>}
  </div>;
}
