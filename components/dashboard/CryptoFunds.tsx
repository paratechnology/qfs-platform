"use client";
import { SUPPORT_HREF } from "@/lib/site";


import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useText } from "@/lib/i18n/text";
import { parseDecimal, reformatDecimal } from "@/lib/i18n/number";
import { useLive } from "@/lib/use-live";
import { cryptoQuantity, formatCryptoQuantity, fundingRequest, FundingError, withdrawalDefaults, type TransactionState, type FundingSnapshot, type FundingRequest, type FundingQuote } from "@/lib/crypto-funds";
import { Spinner } from "./feedback";
import { ArrowDown, ArrowUp, Copy, SwapVert } from "./icons";

export function useCryptoFunds(enabled: boolean) {
  const [data, setData] = useState<FundingSnapshot | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const request = ++generation.current;
    try { const latest = await fundingRequest<FundingSnapshot>("/api/wallet/funds"); if (request === generation.current) { setData(latest); setError(""); } }
    catch (e) { if (request === generation.current) setError((e as Error).message); }
  }, [enabled]);
  useLive(refresh, enabled ? 30_000 : 0);
  return { data, error, refresh };
}

function ErrorMessage({message}: {message: string}) {
  return message ? <p className="fund-error" role="alert">{message}</p> : null;
}

export function FundsPanel({data, error, refresh, onDeposit, onWithdraw, onSwap}: {
  data: FundingSnapshot | null; error: string; refresh: () => unknown; onDeposit: () => void; onWithdraw: () => void; onSwap?: () => void;
}) {
  const tx = useText();
  return <section className="fund-panel" aria-labelledby="funds-heading">
    <div className="fund-heading"><div><span className="dash-page-eyebrow" id="funds-heading">{tx("Available balance")}</span>
      <div className="fund-total" data-available-balance>{data ? data.availableUsd ?? "—" : <span className="dash-skeleton" />}</div>
      <p>{tx("USD account and estimated crypto value. Reserved funds and invested principal are excluded.")}</p>
      {data && <p className="fund-portfolio-total" title={tx("USD account and estimated crypto value, including invested principal.")}>{tx("Portfolio balance")}: <bdi>{data.totalUsd ?? "—"}</bdi></p>}</div>
      <div className="fund-actions"><button className="dash-btn primary" onClick={onDeposit}><ArrowDown size={16}/>{tx("Deposit")}</button>
        <button className="dash-btn ghost" onClick={onWithdraw}><ArrowUp size={16}/>{tx("Withdraw")}</button>
        {onSwap && <button className="dash-btn ghost" onClick={onSwap}><SwapVert size={16}/>{tx("Swap")}</button>}</div></div>
    {error && <div className="dash-load-error"><p>{error}</p><button className="dash-btn ghost" onClick={refresh}>{tx("Retry")}</button></div>}
    {data && !data.valuationComplete && <p className="dash-input-note">{tx("Some crypto prices are unavailable. Your quantities are unchanged; the combined USD estimate is temporarily unavailable.")}</p>}
    {data && <div className="fund-assets">
      <div className="fund-asset-row"><span className="fund-asset-symbol">$</span><div className="fund-asset-name"><strong>{tx("USD account")}</strong><span>{tx("Available to invest or withdraw")}</span></div><div className="fund-asset-value"><strong>{data.usd.available}</strong><span>{tx("Available")}</span></div></div>
      {data.holdings.filter(asset => asset.quantity !== "0" || asset.reserved !== "0").map(asset => <div className="fund-asset-row" key={asset.assetKey} data-asset-key={asset.assetKey}><span className="fund-asset-symbol" aria-hidden="true">{asset.symbol === "BTC" ? "₿" : asset.symbol === "ETH" ? "Ξ" : asset.symbol === "XRP" ? "X" : asset.symbol === "SOL" ? "◎" : "₮"}</span>
        <div className="fund-asset-name"><strong>{asset.symbol}</strong><span>{asset.network}</span></div>
        <div className="fund-asset-value"><strong><bdi>{formatCryptoQuantity(asset.available, tx.locale)} {asset.symbol}</bdi></strong><span>{asset.availableUsd == null ? tx("Price unavailable") : asset.availableUsd}</span>
          {asset.reserved !== "0" && <span>{tx("Reserved: {quantity}", {quantity: `${formatCryptoQuantity(asset.reserved, tx.locale)} ${asset.symbol}`})}</span>}</div></div>)}
      <p className="dash-input-note">{tx("Crypto values change until invested. Investments and their returns are fixed in USD.")}</p>
    </div>}
    {!!data?.requests.length && <details className="fund-activity"><summary>{tx("Recent funding activity")}</summary>
      {data.requests.slice(0, 8).map(item => <div className="fund-activity-row" key={`${item.type}-${item.id}`}><div><strong>{tx(item.type === "DEPOSIT" ? "Deposit" : "Withdrawal")}</strong><span>{item.network}</span>
        {item.explorerUrl && <a href={item.explorerUrl} target="_blank" rel="noreferrer">{tx("View blockchain transaction ↗")}</a>}
        {item.adminNote && <span>{item.adminNote}</span>}</div>
        <div><bdi>{item.quantity} {item.symbol}</bdi><span className="dash-tx-status" data-status={item.status.toLowerCase()}>{tx(item.status === "PENDING" ? item.type === "WITHDRAWAL" || item.txHash ? "Pending review" : "Awaiting transfer" : item.status === "APPROVED" ? "Approved" : "Rejected")}</span><small>{item.reference}</small></div></div>)}
    </details>}
  </section>;
}

function FundingTabs({mode, setMode, disabled = false}: {mode: string; setMode: (value: string) => void; disabled?: boolean}) {
  const tx = useText();
  return <div className="fund-tabs" aria-label={tx("Funding method")}><button type="button" disabled={disabled} aria-pressed={mode === "CRYPTO"} onClick={() => setMode("CRYPTO")}>{tx("Crypto")}</button>
    <button type="button" disabled={disabled} aria-pressed={mode === "BANK"} onClick={() => setMode("BANK")}>{tx("Bank Transfer")}</button></div>;
}

function AddressQr({address}: {address: string}) {
  const tx = useText();
  const [matrix, setMatrix] = useState<{size: number; image: string} | null>(null);
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(280);
  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.max(1, Math.floor(entry.contentRect.width) - 8)));
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setMatrix(null);
    setFailed(false);
    void import("@/lib/qr-code").then(({qrcodegen}) => {
      const qr = qrcodegen.QrCode.encodeText(address, qrcodegen.QrCode.Ecc.MEDIUM);
      const size = qr.size + 8;
      const scale = 20;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size * scale;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("QR rendering unavailable");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#000";
      for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) context.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
      if (!cancelled) setMatrix({size, image: canvas.toDataURL("image/png")});
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [address]);
  const pixels = matrix ? matrix.size * Math.max(1, Math.floor(Math.min(280, availableWidth) / matrix.size)) : 240;
  return <div className="fund-qr-block" ref={frame}><div className="fund-qr">{matrix ? <img src={matrix.image} alt={tx("Receiving address QR code")} width={pixels} height={pixels} data-modules={matrix.size} /> : failed ? <span style={{color:"#000",fontSize:12,padding:12}}>{tx("Copy the receiving address shown above.")}</span> : <Spinner />}</div>
    {matrix && <button className="dash-btn ghost" onClick={() => {
      const link = document.createElement("a"); link.href = matrix.image; link.download = "deposit-qr.png";
      document.body.appendChild(link); link.click(); link.remove();
    }}>{tx("Download QR code")}</button>}
  </div>;
}

export function DepositFunds({data, refresh, bankForm, readOnly = false, onBusy}: {
  data: FundingSnapshot | null; refresh: () => Promise<void>; bankForm: ReactNode; readOnly?: boolean; onBusy?: (value: boolean) => void;
}) {
  const tx = useText();
  const [mode, setMode] = useState("CRYPTO");
  const [walletId, setWalletId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [intent, setIntent] = useState<FundingRequest | null>(null);
  const [hash, setHash] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const reference = useRef("");
  const quantityLocale = useRef(tx.locale);
  useEffect(() => {
    const previous = quantityLocale.current;
    if (previous === tx.locale) return;
    quantityLocale.current = tx.locale;
    const value = cryptoQuantity(quantity, previous);
    if (value !== null) setQuantity(formatCryptoQuantity(value, tx.locale));
  }, [quantity, tx.locale]);
  const activeWallet = walletId ? data?.wallets.find(wallet => wallet.id === walletId) : data?.wallets[0];
  useEffect(() => { if (!walletId && data?.wallets[0]) setWalletId(data.wallets[0].id); }, [data?.wallets, walletId]);
  const asset = data?.holdings.find(row => row.assetKey === intent?.assetKey);
  const currentIntent = data?.requests.find(item => item.type === "DEPOSIT" && item.id === intent?.id) ?? intent;
  const reviewed = currentIntent?.status === "APPROVED" || currentIntent?.status === "REJECTED";
  async function act(label: string, operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError(""); onBusy?.(true);
    try { await operation(); } catch (e) { setError(tx((e as Error).message)); }
    finally { lock.current = false; setBusy(""); onBusy?.(false); }
  }
  function resume(item: FundingRequest) {
    let savedHash = "";
    let pending = false;
    let savedSubmission = false;
    try { savedHash = sessionStorage.getItem(`qfs.deposit.${item.id}`) ?? ""; pending = sessionStorage.getItem(`qfs.deposit.pending.${item.id}`) === "1"; savedSubmission = sessionStorage.getItem(`qfs.deposit.submitted.${item.id}`) === "1"; } catch { /* Storage is optional. */ }
    setIntent(item); setHash(item.txHash ?? savedHash); setSubmitted(!!item.txHash || savedSubmission); setUncertain(pending && !item.txHash); setError("");
  }
  async function createIntent() {
    if (readOnly) throw new Error(tx("This local preview is read-only. Create an account to use this action."));
    if (!activeWallet) throw new Error(tx(walletId ? "This receiving wallet is no longer accepting new deposits." : "Crypto deposits are not configured yet."));
    const value = cryptoQuantity(quantity, tx.locale);
    if (!value) throw new Error(tx("Enter a crypto quantity without thousands separators."));
    if (!reference.current) reference.current = `DEP-${crypto.randomUUID()}`;
    const result = await fundingRequest<{request: FundingRequest}>("/api/wallet/deposits", "POST", {walletId: activeWallet.id, quantity:value, reference:reference.current});
    setIntent(result.request); await refresh();
  }
  async function attach(value: string) {
    if (!intent) return;
    await fundingRequest(`/api/wallet/deposits/${intent.id}`, "PATCH", {txHash: value.trim()});
    setSubmitted(true);
    if (value.trim()) setUncertain(false);
    try {
      sessionStorage.setItem(`qfs.deposit.submitted.${intent.id}`, "1");
      if (value.trim()) { sessionStorage.removeItem(`qfs.deposit.${intent.id}`); sessionStorage.removeItem(`qfs.deposit.pending.${intent.id}`); }
    } catch { /* Storage is optional. */ }
    await refresh();
  }
  async function pay() {
    if (!intent || !asset || hash || uncertain) return;
    let attempted = false;
    try {
      const { sendCryptoDeposit } = await import("@/lib/wallet-client");
      const txHash = await sendCryptoDeposit(asset, intent.receivingAddress, intent.quantityAtomic, () => { attempted = true; try {sessionStorage.setItem(`qfs.deposit.pending.${intent.id}`, "1");} catch { /* Storage is optional. */ } });
      setHash(txHash);
      try { sessionStorage.setItem(`qfs.deposit.${intent.id}`, txHash); } catch { /* The hash remains visible for manual submission. */ }
      await attach(txHash);
    } catch (e) {
      if (attempted && (e as {code?: number}).code !== 4001) setUncertain(true);
      if ((e as {code?: number}).code === 4001) {
        try {sessionStorage.removeItem(`qfs.deposit.pending.${intent.id}`);} catch { /* Storage is optional. */ }
        throw new Error(tx("Payment cancelled in your wallet."));
      }
      throw e;
    }
  }
  return <><FundingTabs mode={mode} setMode={setMode} disabled={!!busy}/>{mode === "BANK" ? bankForm : <div className="dash-modal-body fund-form">
    <ErrorMessage message={error}/>
    {!data && !readOnly && <p><Spinner /> {tx("Loading balances…")}</p>}
    {!intent ? <>
      {data?.wallets.length === 0 && <p className="dash-notice">{tx("Crypto deposits are not configured yet.")}</p>}
      <div className="dash-form-group"><label htmlFor="crypto-wallet">{tx("Asset and network")}</label><select id="crypto-wallet" className="dash-select" value={activeWallet?.id ?? ""} disabled={!!busy} onChange={e => {setWalletId(e.target.value); reference.current = "";}}>
        {!activeWallet && <option value="" disabled>{tx("Asset and network")}</option>}
        {data?.wallets.map(wallet => {const item = data.holdings.find(row => row.assetKey === wallet.assetKey); return <option key={wallet.id} value={wallet.id}>{item?.symbol} · {item?.network} · {wallet.label}</option>;})}</select></div>
      <div className="dash-form-group"><label htmlFor="crypto-quantity">{tx("Crypto quantity")}</label><input id="crypto-quantity" className="dash-input" inputMode="decimal" dir="ltr" value={quantity} disabled={!!busy} onChange={e => {setQuantity(e.target.value); reference.current = "";}} placeholder={tx.number(0,{useGrouping:false,minimumFractionDigits:2})}/></div>
      <p className="dash-input-note">{tx("Your crypto quantity is credited after the transfer is reviewed. Its USD value is fixed only when you invest.")}</p>
      <button className="dash-btn primary block" disabled={!!busy || !activeWallet || !quantity.trim()} onClick={() => act("Preparing deposit…", createIntent)}>{busy ? <><Spinner/>{tx(busy)}</> : tx("Get deposit instructions")}</button>
      {!!data?.requests.some(item => item.type === "DEPOSIT" && item.status === "PENDING") && <div className="fund-pending"><h3>{tx("Continue a deposit")}</h3>{data.requests.filter(item => item.type === "DEPOSIT" && item.status === "PENDING").map(item => <button className="fund-resume" key={item.id} onClick={() => resume(item)}><span>{item.quantity} {item.symbol}<small>{item.network}</small></span><span>{tx(item.txHash ? "Pending review" : "Pending")} →</span></button>)}</div>}
    </> : <>
      <button type="button" className="dash-btn ghost fund-step-back" disabled={!!busy} onClick={() => {if (lock.current) return; setIntent(null); setHash(""); setSubmitted(false); setUncertain(false); reference.current = ""; setError("");}}><ArrowDown className="fund-back-arrow" size={16}/>{tx("Back to deposits")}</button>
      <div className="fund-transfer-heading"><strong><bdi>{intent.quantity} {intent.symbol}</bdi></strong><span>{intent.network}</span></div>
      <AddressQr address={intent.receivingAddress}/>
      <div className="fund-address"><span>{tx("Receiving address")}</span><code dir="ltr">{intent.receivingAddress}</code>
        <button className="dash-btn ghost" onClick={async () => {try {await navigator.clipboard.writeText(intent.receivingAddress); setCopied(true);} catch {setError(tx("Copy the receiving address shown above."));}}}><Copy size={14}/>{tx(copied ? "Copied" : "Copy")}</button></div>
      {intent.destinationTag != null && <div className="fund-address"><span>{tx("XRP destination tag")}</span><code dir="ltr">{intent.destinationTag}</code><p className="dash-input-note">{tx("Include this destination tag with the transfer.")}</p></div>}
      <p className="dash-input-note">{tx("Send only {symbol} on {network} to this address.", {symbol:intent.symbol, network:intent.network})}</p>
      <p className="dash-input-note">{tx("Deposit reference")}: <code>{intent.reference}</code></p>
      {submitted || reviewed ? <div className="fund-confirmation" role="status"><strong>{tx(currentIntent?.status === "APPROVED" ? "Deposit confirmed" : currentIntent?.status === "REJECTED" ? "Deposit rejected" : "Pending review")}</strong><p>{tx(currentIntent?.status === "APPROVED" ? "The deposit is confirmed and the account balance has been updated." : currentIntent?.status === "REJECTED" ? "Your deposit request was rejected." : "Your deposit is saved for manual review. Your balance will update after admin confirmation.")}</p>
        {currentIntent?.adminNote && <p>{currentIntent.adminNote}</p>}
        <a href="/user/user/dashboard/transactions">{tx("Transaction History")}</a><br /><a href={SUPPORT_HREF}>{tx("Contact support for more information")}</a><br />
        {currentIntent?.txHash && asset && <a href={asset.explorer+currentIntent.txHash} target="_blank" rel="noreferrer">{tx("View blockchain transaction ↗")}</a>}</div> : <>
        {asset?.chainId && !hash && !uncertain ? <button className="dash-btn primary block" disabled={!!busy} onClick={() => act("Confirm in your wallet…", pay)}>{busy ? <><Spinner/>{tx(busy)}</> : tx("Pay with connected wallet")}</button> : null}
        {uncertain && <p className="dash-input-note">{tx("Check your wallet before sending again. If a transfer was sent, paste its transaction hash below.")}</p>}
        {uncertain && !hash && <button className="dash-btn ghost block" disabled={!!busy} onClick={() => {setUncertain(false); try {sessionStorage.removeItem(`qfs.deposit.pending.${intent.id}`);} catch { /* Storage is optional. */ }}}>{tx("No transfer was sent — try again")}</button>}
        <div className="dash-form-group"><label htmlFor="crypto-txhash">{tx("Transaction hash (optional)")}</label><input id="crypto-txhash" className="dash-input" dir="ltr" autoComplete="off" spellCheck={false} maxLength={100} value={hash} disabled={!!busy} onChange={e => setHash(e.target.value)} aria-describedby="deposit-hash-hint" />
          <p id="deposit-hash-hint" className="dash-input-note">{tx("You can submit this deposit for manual review without a transaction hash.")}</p></div>
        <button className="dash-btn ghost block" disabled={!!busy} onClick={() => act("Saving transfer…", () => attach(hash))}>{busy ? <><Spinner/>{tx(busy)}</> : tx("Submit transfer for review")}</button>
      </>}
    </>}
  </div>}</>;
}

export function QuotePreview({quote}: {quote: FundingQuote}) {
  const tx = useText();
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => { const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - Date.now()) / 1000))); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, [quote.id, quote.expiresAt]);
  return <div className="fund-quote"><div><span>{tx("Crypto quantity")}</span><strong><bdi>{quote.quantity} {quote.symbol}</bdi></strong></div>
    <div><span>{tx("USD value")}</span><strong>{quote.amount}</strong></div><div><span>{tx("Network")}</span><span>{quote.network}</span></div>
    <div><span>{tx("Exchange rate")}</span><strong><bdi>{tx("{rate} USD / {symbol}", {rate:quote.rateUsd, symbol:quote.symbol})}</bdi></strong></div>
    <p aria-live={remaining === 0 ? "polite" : "off"}>{remaining === 0 ? tx("Quote expired. Request a new quote.") : tx("Quote valid for {seconds} seconds", {seconds:remaining ?? "—"})}</p></div>;
}

export function WithdrawFunds({data, refresh, bankForm, onChanged, readOnly = false, onBusy, onStateChange}: {
  data: FundingSnapshot | null; refresh: () => Promise<void>; bankForm: ReactNode; onChanged: () => Promise<unknown>; readOnly?: boolean; onBusy?: (value: boolean) => void; onStateChange?: (state: TransactionState) => void;
}) {
  const tx = useText();
  const [mode, setMode] = useState("CRYPTO");
  const [source, setSource] = useState<string>(() => withdrawalDefaults(data).source);
  const [assetKey, setAssetKey] = useState(() => withdrawalDefaults(data).assetKey);
  const initialized = useRef(data !== null);
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [destinationTag, setDestinationTag] = useState("");
  const [quote, setQuote] = useState<FundingQuote | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [savedRequest, setSavedRequest] = useState<FundingRequest | null>(null);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const reference = useRef("");
  const lock = useRef(false);
  const amountLocale = useRef(tx.locale);
  useEffect(() => { onStateChange?.(mode === "BANK" ? "form" : saved ? "submitted" : needsFunds ? "insufficient" : "form"); }, [mode, saved, needsFunds, onStateChange]);
  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    const defaults = withdrawalDefaults(data);
    setSource(defaults.source); setAssetKey(defaults.assetKey);
  }, [data]);
  useEffect(() => {
    const previous = amountLocale.current;
    if (previous === tx.locale) return;
    amountLocale.current = tx.locale;
    if (source === "USD") setAmount(reformatDecimal(amount, previous, tx.locale));
    else {
      const value = cryptoQuantity(amount, previous);
      if (value !== null) setAmount(formatCryptoQuantity(value, tx.locale));
    }
  }, [amount, source, tx.locale]);
  const asset = data?.holdings.find(item => item.assetKey === assetKey);
  const currentRequest = data?.requests.find(item => item.type === "WITHDRAWAL" && item.id === savedRequest?.id) ?? savedRequest;
  function reset() { setQuote(null); setError(""); setNeedsFunds(false); }
  async function submit() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNeedsFunds(false); onBusy?.(true);
    try {
      if (readOnly) throw new Error(tx("This local preview is read-only. Create an account to use this action."));
      if (asset?.chain === "tron" && !address.trim().startsWith("T")) throw new FundingError(tx("Enter a Tron (TRC20) address beginning with T."), "ADDRESS", 400);
      if (!quote) {
        const usdAmount = parseDecimal(amount, tx.locale);
        setQuote(await fundingRequest<FundingQuote>("/api/wallet/quotes", "POST", {purpose:source === "USD" ? "USD_WITHDRAWAL" : "CRYPTO_WITHDRAWAL", assetKey,
          ...(source === "USD" ? {amount:usdAmount} : {quantity:cryptoQuantity(amount, tx.locale)})}));
      } else {
        if (!reference.current) reference.current = `WD-${crypto.randomUUID()}`;
        const result = await fundingRequest<{request: FundingRequest}>("/api/wallet/withdrawals", "POST", {quoteId:quote.id, address:address.trim(), destinationTag:assetKey === "XRP" ? destinationTag.trim() || null : null, reference:reference.current});
        setSavedRequest(result.request);
        setSaved(true);
        await Promise.all([refresh(), onChanged()]).catch(() => setRefreshWarning(true));
      }
    } catch (e) {
      setError((e as Error).message);
      setNeedsFunds(e instanceof FundingError && e.code === "INSUFFICIENT_FUNDS");
      if (e instanceof FundingError && e.code === "QUOTE_EXPIRED") { setQuote(null); reference.current = ""; }
      if (e instanceof FundingError && e.code === "INSUFFICIENT_FUNDS") void refresh();
    }
    finally { setBusy(false); lock.current = false; onBusy?.(false); }
  }
  return <><FundingTabs mode={mode} setMode={setMode} disabled={busy}/>{mode === "BANK" ? bankForm : <div className="dash-modal-body fund-form">
    <ErrorMessage message={error}/>
    {saved ? <div className="fund-confirmation" role="status"><strong>{tx(currentRequest?.status === "APPROVED" ? "Withdrawal approved" : currentRequest?.status === "REJECTED" ? "Withdrawal rejected" : "Withdrawal submitted")}</strong><p>{tx(currentRequest?.status === "APPROVED" ? "Your withdrawal has been approved and paid out." : currentRequest?.status === "REJECTED" ? "Your withdrawal request was rejected and funds returned to your balance." : "Your funds are reserved while the withdrawal is reviewed. The payout transaction will appear in funding activity once paid.")}</p>
      {currentRequest?.reference && <p>{tx("Reference")}: <code>{currentRequest.reference}</code></p>}
      {currentRequest?.adminNote && <p>{currentRequest.adminNote}</p>}
      {refreshWarning && <p>{tx("Your request was saved. The latest balance is temporarily unavailable; do not submit it again.")}</p>}
      <a href="/user/user/dashboard/withdrawals">{tx("View withdrawal details")}</a><br /><a href={SUPPORT_HREF}>{tx("Contact support for more information")}</a>
    </div> : <>
      {!data && <p className="dash-input-note" role="status"><Spinner />{tx("Loading balances…")}</p>}
      <fieldset className="dash-form-fieldset" disabled={busy || !!quote || !data}>
        <div className="dash-form-group"><label htmlFor="withdraw-source">{tx("Withdraw from")}</label><select id="withdraw-source" className="dash-select" value={source} onChange={e => {setSource(e.target.value); setAmount(""); reset();}}>
          <option value="USD">{tx("USD account")} · {data?.usd.available ?? "—"}</option><option value="CRYPTO">{tx("Crypto balance")}</option></select></div>
        <div className="dash-form-group"><label htmlFor="withdraw-asset">{tx("Asset and network")}</label><select id="withdraw-asset" className="dash-select" value={assetKey} onChange={e => {setAssetKey(e.target.value); setAmount(""); setAddress(""); setDestinationTag(""); reset();}}>
          {data?.holdings.map(item => <option key={item.assetKey} value={item.assetKey}>{item.symbol} · {item.network} — {tx("Available")}: {formatCryptoQuantity(item.available, tx.locale)} {item.symbol}</option>)}</select></div>
        <div className="fund-withdraw-balance" aria-live="polite">
          <span>{tx("Available to withdraw")}</span>
          <strong data-withdraw-available><bdi>{source === "USD" ? data?.usd.available ?? "—" : `${asset ? formatCryptoQuantity(asset.available, tx.locale) : "—"} ${asset?.symbol ?? ""}`}</bdi></strong>
          <small>{source === "USD" ? tx("USD account") : asset?.network}</small>
          {source === "CRYPTO" && asset && <small>{asset.availableUsd == null ? tx("Price unavailable") : tx("Estimated USD value: {value}", {value: asset.availableUsd})}</small>}
          {source === "CRYPTO" && asset?.reserved !== "0" && asset && <small>{tx("Reserved: {quantity}", {quantity: `${formatCryptoQuantity(asset.reserved, tx.locale)} ${asset.symbol}`})}</small>}
        </div>
        <div className="dash-form-group"><label htmlFor="withdraw-quantity">{tx(source === "USD" ? "USD amount" : "Crypto quantity")}{source === "CRYPTO" && asset ? ` (${asset.symbol})` : ""}</label><input id="withdraw-quantity" className="dash-input" inputMode="decimal" dir="ltr" value={amount} onChange={e => {setAmount(e.target.value); reset();}} aria-describedby="withdraw-balance-note" />
          <button className="dash-btn ghost fund-withdraw-max" type="button" disabled={!data || (source === "USD" ? !data.usd.availableCents : !asset || BigInt(asset.availableAtomic) === BigInt(0))} onClick={() => {setAmount(source === "USD" ? tx.number(data!.usd.availableCents / 100, {useGrouping:false, maximumFractionDigits:2}) : formatCryptoQuantity(asset!.available, tx.locale)); reset();}}>{tx("Use available balance")}</button>
        </div>
        <p id="withdraw-balance-note" className="dash-input-note">{tx(source === "USD" ? "This withdrawal uses your USD account to pay out in the selected crypto asset." : "Only the available balance on the selected network can be withdrawn. Reserved funds are excluded.")}</p>
        <div className="dash-form-group"><label htmlFor="withdraw-address">{tx("Receiving address")}</label><input id="withdraw-address" className="dash-input" dir="ltr" placeholder={asset?.chain === "tron" ? "T…" : asset?.chainId ? "0x…" : undefined} autoComplete="off" spellCheck={false} value={address} onChange={e => {setAddress(e.target.value); reset();}} />
          {asset?.chain === "tron" && <p className="dash-input-note">{tx("Enter a Tron (TRC20) address beginning with T.")}</p>}
        </div>
        {assetKey === "XRP" && <div className="dash-form-group"><label htmlFor="withdraw-tag">{tx("XRP destination tag")}</label><input id="withdraw-tag" className="dash-input" dir="ltr" inputMode="numeric" maxLength={10} value={destinationTag} onChange={e => {setDestinationTag(e.target.value); reset();}}/><p className="dash-input-note">{tx("Enter the tag supplied by the receiving wallet, if required.")}</p></div>}
      </fieldset>
      {quote && <QuotePreview quote={quote}/>}
      <p className="dash-input-note">{tx("The quoted crypto quantity is the requested payout. No additional platform fee is deducted from this request.")}</p>
      <button className="dash-btn primary block" disabled={busy || !data || !amount.trim() || !address.trim()} onClick={submit}>{busy ? <><Spinner/>{tx("Working…")}</> : tx(quote ? "Confirm withdrawal" : "Review withdrawal")}</button>
      {quote && <button className="dash-btn ghost block" disabled={busy} onClick={() => setQuote(null)}>{tx("Edit or refresh quote")}</button>}
    </>}
  </div>}</>;
}
