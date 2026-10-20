"use client";
import { useEffect, useRef, useState } from "react";
import { useText } from "@/lib/i18n/text";
import type { KycRecord } from "@/lib/api-types";
type Revision = Omit<KycRecord, "id"> & {id: string; event: string; createdAt: string; consentAt: string | null};
const events: Record<string,string> = {BASELINE:"Previous record preserved", SUBMITTED:"Documents submitted", APPROVE:"Identity approved", REQUEST_CHANGES:"Changes requested", REVERIFY:"Reverification requested"};
const kinds: Record<string,string> = {IDENTITY_FRONT:"Identity document — front / passport page",IDENTITY_BACK:"Identity document — back",PORTRAIT:"Face photo"};
export default function KycHistory({ submissionId, revision }: {submissionId?: string; revision?: number}) {
  const tx = useText();
  const [items, setItems] = useState<Revision[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  async function load(before?: number) {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const path = submissionId ? `/api/admin/kyc/${submissionId}/history` : "/api/kyc/history";
      const response = await fetch(path + (before ? `?beforeVersion=${before}` : ""), {cache:"no-store"});
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Could not load verification history.");
      if (current !== generation.current) return;
      setItems(previous => before ? [...previous,...result.data.items] : result.data.items); setCursor(result.data.nextCursor);
    } catch (e) { if (current === generation.current) setError((e as Error).message); }
    finally { if (current === generation.current) setLoading(false); }
  }
  useEffect(() => { setItems([]); void load(); return () => {generation.current++;}; }, [submissionId, revision]);
  return <section className="account-kyc-history"><h3>{tx("Verification history")}</h3>
    {error && <p role="alert">{tx(error)} <button className="dash-btn ghost" onClick={() => void load()}>{tx("Retry")}</button></p>}
    {items.map(item => <details key={item.id}><summary><strong>{tx(events[item.event] ?? item.event)}</strong><span>{tx.date(item.createdAt)} · {tx("Version {version}",{version:item.version})}</span></summary>
      <dl>{Object.entries(item.details).map(([label,value]) => <div key={label}><dt>{tx(({legalName:"Full legal name",dateOfBirth:"Date of birth",country:"Country",address:"Residential address",documentType:"Document type"} as Record<string,string>)[label] ?? label)}</dt><dd>{value}</dd></div>)}</dl>
      {item.reviewNote && <p>{item.reviewNote}</p>}
      {item.consentAt && <p>{tx("Consent recorded")} · {tx.date(item.consentAt)}</p>}
      <ul>{item.files.map(file => <li key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{tx(kinds[file.kind] ?? file.kind)}</a></li>)}</ul>
    </details>)}
    {loading && <p role="status">{tx("Loading verification history…")}</p>}
    {!loading && !error && !items.length && <p>{tx("History will appear after your next submission or review. Earlier document versions may not be available.")}</p>}
    {cursor && <button className="dash-btn ghost" disabled={loading} onClick={() => void load(cursor)}>{tx("Load earlier records")}</button>}
  </section>;
}
