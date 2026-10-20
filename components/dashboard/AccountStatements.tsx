"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useText } from "@/lib/i18n/text";
type Statement = {from:string;to:string;generatedAt:string;balanceCents:number;availableCents:number;transactionCount:number;previewLimited:boolean;
  transactions:{reference:string;type:string;status:string;createdAt:string;displayAmount:string;feeCents:number;assetKey:string|null}[]};
const labels:Record<string,string>={DEPOSIT:"Deposit",WITHDRAWAL:"Withdrawal",INVESTMENT:"Investment",EARNING:"Earning",REFERRAL_BONUS:"Referral Bonus",LOAN:"Loan",ADJUSTMENT:"Adjustment",PRINCIPAL_RETURN:"Principal return",SWAP:"Crypto swap",PENDING:"Pending",COMPLETED:"Completed",CANCELLED:"Cancelled",FAILED:"Failed"};
export default function AccountStatements() {
  const tx = useText();
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [data, setData] = useState<Statement|null>(null); const [busy,setBusy] = useState(false); const [error,setError] = useState("");
  const sequence = useRef(0);
  async function load(event?: FormEvent) {
    event?.preventDefault(); const current = ++sequence.current; setBusy(true);setError("");
    try {
      const query = new URLSearchParams({...from ? {from}:{},...to ? {to}:{}});
      const response = await fetch(`/api/account/statement?${query}`, {cache:"no-store"}); const result = await response.json();
      if(!response.ok||!result.ok) throw new Error(result.error?.message ?? "Could not load your statement.");
      if(current!==sequence.current)return;
      setData(result.data);setFrom(result.data.from);setTo(result.data.to);
    } catch(e) {if(current===sequence.current)setError((e as Error).message);}
    finally{if(current===sequence.current)setBusy(false);}
  }
  useEffect(()=>{void load();return()=>{sequence.current++;};},[]);
  const path = data ? `/api/account/statement?${new URLSearchParams({from:data.from,to:data.to})}` : "";
  return <div className="account-statements">
    <form className="account-statement-toolbar" onSubmit={e=>void load(e)}><label>{tx("From")}<input type="date" className="dash-input" value={from} onChange={e=>setFrom(e.target.value)} required disabled={busy}/></label><label>{tx("To")}<input type="date" className="dash-input" value={to} onChange={e=>setTo(e.target.value)} required disabled={busy}/></label><button className="dash-btn primary" disabled={busy}>{tx(busy?"Loading…":"Apply period")}</button></form>
    {error&&<p className="dash-form-error" role="alert">{tx(error)} <button className="dash-btn ghost" onClick={()=>void load()}>{tx("Retry")}</button></p>}
    {busy&&<p role="status"><span className="action-spinner" aria-hidden="true" /> {tx("Preparing account statement…")}</p>}
    {data&&<><header><h2>{data.from} — {data.to}</h2><p>{tx("Activity timestamps use UTC. Downloads include the full selected period.")}</p><div className="dash-actions-row"><a className="dash-btn ghost" href={`${path}&format=csv`}>{tx("Download CSV")}</a><a className="dash-btn ghost" href={`${path}&format=print`} target="_blank" rel="noreferrer">{tx("Print / save as PDF")}</a></div></header>
      <p className="account-hint">{tx("Current USD balance")} {tx.money(data.balanceCents)} · {tx("Available")} {tx.money(data.availableCents)}<br/>{tx("Snapshot generated")} {tx.date(data.generatedAt)}</p>
      <p className="account-hint">{tx("Balances and investment records in your download show their current state, not historical opening or closing balances. Internal investment allocations are not income.")}</p>
      <div className="account-statement-table"><table><thead><tr>{["Date","Reference","Type","Status","Amount","Fee"].map(label=><th key={label}>{tx(label)}</th>)}</tr></thead><tbody>{data.transactions.map(row=><tr key={row.reference}><td>{tx.date(row.createdAt)}</td><td><code>{row.reference}</code></td><td>{tx(labels[row.type] ?? row.type)}{row.assetKey&&<small>{row.assetKey}</small>}</td><td>{tx(labels[row.status] ?? row.status)}</td><td>{row.displayAmount}</td><td>{tx.money(row.feeCents)}</td></tr>)}</tbody></table></div>
      {!data.transactions.length&&<p>{tx("No activity in this period.")}</p>}{data.previewLimited&&<p>{tx("Showing the first 500 records. Download CSV or the printable statement for the complete period.")}</p>}
    </>}
  </div>;
}
