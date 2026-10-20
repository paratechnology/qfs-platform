"use client";
import {useState} from "react";
import {PageHeader,DataTable,ErrorBanner,Spinner,useFetch,type Column} from "@/components/admin/ui";
import {useText} from "@/lib/i18n/text";
type Row={userId:string;name:string;email:string;issues:{code:string;asset:string;expected:string;actual:string}[]};
type Report={items:Row[];checkedAt:string;nextCursor:string|null};
export default function ReconciliationPage(){
 const tx=useText();const [after,setAfter]=useState("");const {data,error,loading,reload}=useFetch<Report>(`/api/admin/reconciliation${after?`?after=${encodeURIComponent(after)}`:""}`,{intervalMs:0});
 const columns:Column<Row>[]=[{label:"Account",render:row=><><strong>{row.name}</strong><small style={{display:"block"}}>{row.email}</small></>},{label:"Checks",render:row=>row.issues.length?<details><summary>{tx("{count} discrepancies",{count:row.issues.length})}</summary>{row.issues.map((issue,i)=><div key={i} className="account-reconciliation-issue"><code>{issue.code} · {issue.asset}</code><p>{tx("Expected")}: {issue.expected}<br/>{tx("Recorded")}: {issue.actual}</p></div>)}</details>:<span>{tx("No discrepancies found")}</span>}];
 return <><PageHeader title={tx("Balance reconciliation")} subtitle={tx("Checks account reservations, latest ledger balances and completed swap records. No balances are changed.")} actions={<button className="adm-btn ghost" onClick={()=>void reload()} disabled={loading}>{tx("Run checks again")}</button>}/>
 <p className="adm-banner">{tx("This checks internal records. It does not verify treasury assets on the blockchain or reconstruct the complete historical ledger.")}</p>
 {error&&<ErrorBanner message={error} onRetry={reload}/>}{loading&&!data?<Spinner label={tx("Checking account records…")}/>:data&&<><p>{tx("Checked {count} accounts on this page",{count:data.items.length})} · {tx.date(data.checkedAt)}</p><DataTable columns={columns} rows={data.items}/><div className="adm-toolbar">{after&&<button className="adm-btn ghost" onClick={()=>setAfter("")}>{tx("First accounts")}</button>}{data.nextCursor&&<button className="adm-btn ghost" onClick={()=>setAfter(data.nextCursor!)}>{tx("Check next accounts")}</button>}</div></>}
 </>;
}
