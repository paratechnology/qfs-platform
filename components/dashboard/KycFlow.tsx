"use client";
import { useText } from "@/lib/i18n/text";


import { useCallback, useEffect, useRef, useState } from "react";
import type { KycDetails, KycRecord, KycSummary } from "@/lib/api-types";
import { ListSkeleton, LoadError, Spinner } from "./feedback";
import { Check, FilePdf, RightArrow } from "./icons";
import KycHistory from "./KycHistory";
import { ActionNotice } from "@/components/ActionFeedback";

async function request(path: string, options?: RequestInit): Promise<KycRecord> {
  const response = await fetch(path, { cache: "no-store", ...options });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) throw new Error(json?.error?.message ?? "Could not save verification. Please try again.");
  return json.data;
}

export default function KycFlow({ name, demo, onStatus }: { name: string; demo: boolean; onStatus: (status: KycSummary) => void }) {
  const tx = useText();
  const [record, setRecord] = useState<KycRecord | null>(null);
  const [fields, setFields] = useState<KycDetails>({ legalName: name, dateOfBirth: "", country: "", address: "", documentType: "PASSPORT" });
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [consent, setConsent] = useState(false);
  const locked = useRef(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const current = await request("/api/kyc");
      setRecord(current); setFields((initial) => ({ ...initial, ...current.details }));
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (!demo) void load(); else setLoading(false); }, [load, demo]);

  async function act(label: string, task: () => Promise<KycRecord>) {
    if (locked.current) return;
    locked.current = true; setBusy(label); setError(""); setMessage("");
    try { const next = await task(); setRecord(next); onStatus(next); setMessage("Verification details saved."); return next; }
    catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setBusy(""); }
  }
  async function saveDetails() {
    const result = await act("Saving details…", () => request("/api/kyc", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    }));
    if (result) setStep(1);
  }
  async function upload(kind: string, file?: File) {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError("Each file must be 3 MB or smaller."); return; }
    const form = new FormData(); form.append("kind", kind); form.append("file", file);
    await act("Uploading document…", () => request("/api/kyc/files", { method: "POST", body: form }));
  }
  const required = ["IDENTITY_FRONT", ...(fields.documentType === "PASSPORT" ? [] : ["IDENTITY_BACK"]), "PORTRAIT"];
  const complete = required.every((kind) => record?.files.some((file) => file.kind === kind));
  const labels: Record<string, string> = { IDENTITY_FRONT: fields.documentType === "PASSPORT" ? "Passport photo page" : "Identity document — front", IDENTITY_BACK: "Identity document — back", PORTRAIT: "Photo of your face" };

  if (demo) return <div className="dash-notice">{tx("Verification uploads are available on a real account.")}</div>;
  if (loading) return <ListSkeleton label={tx("Loading your verification")} />;
  if (!record) return <LoadError message={error} retry={() => void load()} />;
  if (record.status === "APPROVED" || record.status === "PENDING") return <section className="dash-kyc-status">
    <Check size={24} /><h2>{tx(record.status === "APPROVED" ? "Identity verified" : "Documents submitted")}</h2>
    <p>{tx(record.status === "APPROVED" ? "Your identity documents have been approved by the review team." : "Your documents are awaiting admin review. You’ll receive an account notification when a decision is made.")}</p>
    {record.submittedAt && <p className="dash-input-note">{tx("Submitted {value0}", { value0: tx.date(record.submittedAt, {hour:"2-digit",minute:"2-digit"}) })}</p>}
    {record.reviewNote && <p>{record.reviewNote}</p>}
    <KycHistory revision={record.version} />
  </section>;

  return <section className="dash-kyc-flow">
    {message && <ActionNotice message={message} />}
    {record.submittedAt && <KycHistory revision={record.version} />}
    {record.status === "NEEDS_CHANGES" && <div className="dash-notice" role="status"><span><strong>{tx("Changes requested")}</strong><br />{record.reviewNote}</span></div>}
    <ol className="dash-kyc-steps" aria-label={tx("Verification steps")}>{["Your details", "Documents", "Review & submit"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span>{tx(label)}</li>)}</ol>
    {error && <div className="dash-load-error" role="alert">{tx(error)}</div>}
    <fieldset className="dash-form-fieldset" disabled={!!busy}>
      {step === 0 && <form onSubmit={(event) => { event.preventDefault(); void saveDetails(); }}>
        <div className="dash-kyc-fields">
          <div className="dash-form-group"><label htmlFor="kyc-name">{tx("Full legal name")}</label><input className="dash-input" id="kyc-name" required maxLength={120} autoComplete="name" value={fields.legalName} onChange={(e) => setFields({ ...fields, legalName: e.target.value })} /></div>
          <div className="dash-form-group"><label htmlFor="kyc-birth">{tx("Date of birth")}</label><input className="dash-input" id="kyc-birth" type="date" required autoComplete="bday" value={fields.dateOfBirth} onChange={(e) => setFields({ ...fields, dateOfBirth: e.target.value })} /></div>
          <div className="dash-form-group"><label htmlFor="kyc-country">{tx("Country of residence")}</label><input className="dash-input" id="kyc-country" required maxLength={80} autoComplete="country-name" value={fields.country} onChange={(e) => setFields({ ...fields, country: e.target.value })} /></div>
          <div className="dash-form-group"><label htmlFor="kyc-document-type">{tx("Identity document")}</label><select className="dash-select" id="kyc-document-type" value={fields.documentType} onChange={(e) => setFields({ ...fields, documentType: e.target.value as KycDetails["documentType"] })}><option value="PASSPORT">{tx("Passport")}</option><option value="NATIONAL_ID">{tx("National identity card")}</option><option value="DRIVING_LICENSE">{tx("Driving licence")}</option></select></div>
        </div>
        <div className="dash-form-group"><label htmlFor="kyc-address">{tx("Residential address")}</label><textarea className="dash-input" id="kyc-address" required maxLength={500} autoComplete="street-address" rows={3} value={fields.address} onChange={(e) => setFields({ ...fields, address: e.target.value })} /></div>
        <button className="dash-btn primary" type="submit">{busy ? <><Spinner />{tx(busy)}</> : <>{tx("Save & continue")}<RightArrow size={15} /></>}</button>
      </form>}
      {step === 1 && <>
        <p className="dash-input-note">{tx("Upload clear, uncropped images. JPG, PNG, or PDF, up to 3 MB per file. Your face photo must be JPG or PNG.")}</p>
        <div className="dash-kyc-upload-list">{required.map((kind) => {
          const saved = record.files.find((file) => file.kind === kind);
          return <div className="dash-kyc-upload" key={kind}><div><strong>{labels[kind]}</strong><span>{saved ? tx("Uploaded securely") : kind === "PORTRAIT" ? tx("A recent photo with your face clearly visible") : tx("All text and document edges must be visible")}</span>
            {saved && <a href={saved.url} target="_blank" rel="noreferrer">{tx("Download uploaded file")}</a>}</div>
            <label className="dash-btn ghost">{busy ? <Spinner /> : saved ? <Check size={15} /> : <FilePdf size={15} />}{tx(saved ? "Replace" : "Choose file")}<input type="file" aria-label={labels[kind]} accept={kind === "PORTRAIT" ? "image/jpeg,image/png" : "image/jpeg,image/png,application/pdf"} onChange={(event) => { void upload(kind, event.target.files?.[0]); event.target.value = ""; }} /></label>
          </div>;
        })}</div>
        <div className="dash-actions-row"><button className="dash-btn ghost" onClick={() => setStep(0)}>{tx("Back")}</button><button className="dash-btn primary" disabled={!complete} onClick={() => setStep(2)}>{tx("Review submission")}<RightArrow size={15} /></button></div>
        {busy && <p role="status"><Spinner /> {tx(busy)}</p>}
      </>}
      {step === 2 && <>
        <dl className="dash-investment-terms"><div><dt>{tx("Legal name")}</dt><dd>{fields.legalName}</dd></div><div><dt>{tx("Date of birth")}</dt><dd>{fields.dateOfBirth}</dd></div><div><dt>{tx("Country")}</dt><dd>{fields.country}</dd></div><div><dt>{tx("Address")}</dt><dd>{fields.address}</dd></div><div><dt>{tx("Documents")}</dt><dd>{required.length} uploaded</dd></div></dl>
        <p className="dash-input-note">{tx("Documents are stored privately and reviewed by authorised admins. This review does not include automated liveness checks.")}</p>
        <label className="dash-kyc-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{tx("I confirm these details are mine and authorise their review for identity verification.")}</label>
        <div className="dash-actions-row"><button className="dash-btn ghost" onClick={() => setStep(1)}>{tx("Back")}</button><button className="dash-btn primary" disabled={!consent || !complete} onClick={() => void act("Submitting for review…", () => request("/api/kyc/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }) }))}>{busy ? <><Spinner />{tx(busy)}</> : "Submit for review"}</button></div>
      </>}
    </fieldset>
  </section>;
}
