"use client";

import { useEffect, useState } from "react";
import { LANGUAGES, type Locale } from "@/lib/i18n/locales";
import { useText } from "@/lib/i18n/text";
import { Field } from "./ui";

export type PlanTranslation = { description: string; terms: string; riskDisclosure: string; sourceHash: string };
export type PlanTranslations = Partial<Record<Locale, PlanTranslation>>;
type Materials = Pick<PlanTranslation, "description" | "terms" | "riskDisclosure">;
const EMPTY = { description: "", terms: "", riskDisclosure: "" };

export default function PlanTranslationEditor({ materials, versions, onChange, onDirty, disabled }: {
  materials: Materials; versions: PlanTranslations; onChange: (versions: PlanTranslations) => void;
  onDirty: (dirty: boolean) => void; disabled: boolean;
}) {
  const tx = useText();
  const [language, setLanguage] = useState<Locale>("es");
  const [draft, setDraft] = useState<Materials | null>(null);
  const [hash, setHash] = useState<{ source: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const source = [materials.description, materials.terms, materials.riskDisclosure].map((value) => value.trim()).join("\0");
  useEffect(() => {
    let cancelled = false;
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)).then((digest) => {
      if (!cancelled) setHash({ source, value: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") });
    }).catch(() => { if (!cancelled) setError("Unable to prepare the translation. Refresh and try again."); });
    return () => { cancelled = true; };
  }, [source]);
  const currentHash = hash?.source === source ? hash.value : null;
  const version = versions[language];
  const fields = draft ?? version ?? EMPTY;
  const update = (key: keyof Materials, value: string) => {
    setDraft({ ...fields, [key]: value });
    onDirty(true);
    setError("");
  };
  const apply = () => {
    if (!currentHash) return;
    for (const key of ["description", "terms", "riskDisclosure"] as const) {
      if (materials[key].trim() && !fields[key].trim()) {
        setError("Complete the translated description, terms, and risk disclosure before publishing this language.");
        return;
      }
    }
    onChange({ ...versions, [language]: { description: fields.description.trim(), terms: fields.terms.trim(), riskDisclosure: fields.riskDisclosure.trim(), sourceHash: currentHash } });
    setDraft(null);
    onDirty(false);
    setError("");
  };
  return <details className="adm-plan-translations">
    <summary>{tx("Language versions")} <span className="adm-note">{tx("{count, plural, =0 {No translations} one {# translation} other {# translations}}", { count: Object.keys(versions).length })}</span></summary>
    <p className="adm-note">{tx("Review each translation against the English description, terms, and risk disclosure. Existing investments keep their recorded materials.")}</p>
    <Field label={tx("Translation language")}><select className="adm-input" value={language} disabled={disabled || !!draft} onChange={(event) => { setLanguage(event.target.value as Locale); setError(""); }}>
      {LANGUAGES.filter((item) => item.code !== "en").map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}
    </select></Field>
    {version && <p className="adm-note">{tx(currentHash && version.sourceHash === currentHash ? "This version matches the current English materials." : "The English materials have changed. Review this translation before publishing it again.")}</p>}
    <div lang={language} dir={LANGUAGES.find((item) => item.code === language)?.direction}>
      <Field label={tx("Translated description")}><textarea className="adm-textarea" maxLength={300} disabled={disabled} value={fields.description} onChange={(event) => update("description", event.target.value)} /></Field>
      <Field label={tx("Translated plan terms")}><textarea className="adm-textarea" rows={5} maxLength={10000} disabled={disabled} value={fields.terms} onChange={(event) => update("terms", event.target.value)} /></Field>
      <Field label={tx("Translated risk disclosure")}><textarea className="adm-textarea" rows={4} maxLength={10000} disabled={disabled} value={fields.riskDisclosure} onChange={(event) => update("riskDisclosure", event.target.value)} /></Field>
    </div>
    {error && <p className="adm-banner error" role="alert">{tx(error)}</p>}
    <div className="adm-row-end">
      {draft && <button type="button" className="adm-btn ghost" disabled={disabled} onClick={() => { setDraft(null); onDirty(false); setError(""); }}>{tx("Discard translation edits")}</button>}
      {version && !draft && <button type="button" className="adm-btn ghost" disabled={disabled} onClick={() => { const next = { ...versions }; delete next[language]; onChange(next); }}>{tx("Remove language version")}</button>}
      <button type="button" className="adm-btn primary" disabled={disabled || !currentHash || (!draft && !version)} onClick={apply}>{tx("Use reviewed translation")}</button>
    </div>
    <p className="adm-note">{tx("Language versions are published when you save the plan. PDFs keep their original language.")}</p>
  </details>;
}
