"use client";
import type { FeedbackMessage } from "@/components/ActionFeedback";
import { useText } from "@/lib/i18n/text";
import { parseDecimal, reformatDecimal } from "@/lib/i18n/number";


import { useCallback, useEffect, useRef, useState } from "react";
import { useLive } from "@/lib/use-live";
import PlanTranslationEditor, { type PlanTranslations } from "@/components/admin/PlanTranslationEditor";
import {
  apiGet,
  apiSend,
  Confirm,
  DataTable,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  Spinner,
  StatusPill,
  Toast,
  type Column,
  useFetch,
} from "@/components/admin/ui";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  terms: string | null;
  riskDisclosure: string | null;
  documentIds: string;
  minAmountCents: number;
  maxAmountCents: number | null;
  monthlyRoiBps: number;
  termMonths: number;
  payoutInterval: "MONTHLY" | "HOURLY";
  principalRelease: "MANUAL" | "AUTOMATIC";
  isActive: boolean;
  sort: number;
  color: string;
  createdAt: string;
  translations?: string | null;
};

type FormState = {
  id?: string;
  name: string;
  description: string;
  terms: string;
  riskDisclosure: string;
  documentIds: string[];
  minAmount: string;
  maxAmount: string;
  monthlyRoiPct: string;
  termMonths: string;
  payoutInterval: "MONTHLY" | "HOURLY";
  principalRelease: "MANUAL" | "AUTOMATIC";
  sort: string;
  isActive: boolean;
  color: string;
  translations: PlanTranslations;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  terms: "",
  riskDisclosure: "",
  documentIds: [],
  minAmount: "100",
  maxAmount: "",
  monthlyRoiPct: "5.0",
  termMonths: "6",
  payoutInterval: "MONTHLY",
  principalRelease: "MANUAL",
  sort: "1",
  isActive: true,
  color: "#992c92",
  translations: {},
};

const PLAN_COLORS = ["#992c92", "#ceff0c", "#2ed47a", "#4da3ff", "#ffb020", "#ff5f77", "#d86fd0"];

export default function AdminPlansPage() {
  const tx = useText();
  const documents = useFetch<Array<{ id: string; title: string; isActive: boolean }>>("/api/admin/documents");
  const [data, setData] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<FeedbackMessage | null>(null);
  const [translationDirty, setTranslationDirty] = useState(false);
  const amountLocale = useRef(tx.locale);
  useEffect(() => {
    const previous = amountLocale.current;
    if (previous === tx.locale) return;
    amountLocale.current = tx.locale;
    setEditor((current) => current && {
      ...current,
      minAmount: reformatDecimal(current.minAmount, previous, tx.locale),
      maxAmount: reformatDecimal(current.maxAmount, previous, tx.locale),
      monthlyRoiPct: reformatDecimal(current.monthlyRoiPct, previous, tx.locale),
      termMonths: reformatDecimal(current.termMonths, previous, tx.locale, 0),
      sort: reformatDecimal(current.sort, previous, tx.locale, 0),
    });
  }, [tx.locale]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<Plan[]>("/api/admin/plans"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useLive(load);

  const openCreate = () => { setTranslationDirty(false); setEditor({ ...EMPTY_FORM, monthlyRoiPct:tx.number(5, {useGrouping:false,minimumFractionDigits:1}), translations: {} }); };

  const openEdit = (p: Plan) => {
    setTranslationDirty(false);
    setEditor({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      terms: p.terms ?? "",
      riskDisclosure: p.riskDisclosure ?? "",
      documentIds: JSON.parse(p.documentIds ?? "[]"),
      minAmount: tx.number(p.minAmountCents / 100, {useGrouping:false,maximumFractionDigits:2}),
      maxAmount: p.maxAmountCents ? tx.number(p.maxAmountCents / 100, {useGrouping:false,maximumFractionDigits:2}) : "",
      monthlyRoiPct: tx.number(p.monthlyRoiBps / 100, {useGrouping:false,maximumFractionDigits:2}),
      termMonths: tx.number(p.termMonths, {useGrouping:false}),
      payoutInterval: p.payoutInterval,
      principalRelease: p.principalRelease ?? "MANUAL",
      sort: tx.number(p.sort, {useGrouping:false}),
      isActive: p.isActive,
      color: p.color,
      translations: JSON.parse(p.translations ?? "{}"),
    });
  };

  const save = async () => {
    if (!editor || translationDirty) return;
    const body = {
      name: editor.name.trim(),
      description: editor.description.trim() || undefined,
      terms: editor.terms.trim() || null,
      riskDisclosure: editor.riskDisclosure.trim() || null,
      documentIds: editor.documentIds,
      minAmount: parseDecimal(editor.minAmount, tx.locale),
      maxAmount: editor.maxAmount.trim() ? parseDecimal(editor.maxAmount, tx.locale) : null,
      monthlyRoiPct: parseDecimal(editor.monthlyRoiPct, tx.locale),
      termMonths: parseDecimal(editor.termMonths, tx.locale, 0),
      payoutInterval: editor.payoutInterval,
      principalRelease: editor.principalRelease,
      isActive: editor.isActive,
      sort: parseDecimal(editor.sort, tx.locale, 0),
      color: editor.color,
      translations: editor.translations,
    };
    if (!body.name || !body.minAmount || body.minAmount <= 0) {
      setToast({message: "Name and a valid minimum amount are required", tone: "error"});
      return;
    }
    if (body.monthlyRoiPct === null || body.termMonths === null || body.sort === null || (editor.maxAmount.trim() && body.maxAmount === null)) {
      setToast({message: "Enter valid amounts, a monthly return, and whole numbers for the term and sort order.", tone: "error"});
      return;
    }
    setBusy(true);
    try {
      if (editor.id) {
        await apiSend(`/api/admin/plans/${editor.id}`, "PATCH", body);
        setToast(tx("Plan \"{name}\" updated", { name: body.name }));
      } else {
        await apiSend("/api/admin/plans", "POST", body);
        setToast(tx("Plan \"{name}\" created", { name: body.name }));
      }
      setEditor(null);
      load();
    } catch (e) {
      setToast({message: (e as Error).message, tone: "error"});
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiSend(`/api/admin/plans/${deleteTarget.id}`, "DELETE");
      setToast(tx("Plan \"{name}\" deleted", { name: deleteTarget.name }));
      setDeleteTarget(null);
      load();
    } catch (e) {
      setToast({message: (e as Error).message, tone: "error"});
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Plan>[] = [
    {
      label: "Plan",
      render: (p) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 4,
              background: p.color || "#992c92",
              flexShrink: 0,
            }}
          />
          <div>
            <b>{p.name}</b>
            {p.description && <span className="adm-cell-sub">{tx(p.description)}</span>}
          </div>
        </div>
      ),
    },
    { label: "Monthly ROI", render: (p) => `${tx.number(p.monthlyRoiBps / 100, {minimumFractionDigits:1,maximumFractionDigits:2})}%` },
    { label: "Min", render: (p) => <span className="num">{tx.money(p.minAmountCents)}</span> },
    {
      label: "Max",
      render: (p) => <span className="num">{p.maxAmountCents ? tx.money(p.maxAmountCents) : tx("Unlimited")}</span>,
    },
    { label: "Term", render: (p) => tx("{count, plural, one {# month} other {# months}}", { count: p.termMonths }) },
    { label: "Payout", render: (p) => tx(p.payoutInterval === "HOURLY" ? "Hourly" : "Monthly") },
    { label: "Principal release", render: (p) => tx(p.principalRelease === "AUTOMATIC" ? "Automatic" : "Admin approval") },
    { label: "Sort", render: (p) => <span className="num">{p.sort}</span> },
    { label: "Status", render: (p) => <StatusPill status={p.isActive ? "Active" : "Disabled"} /> },
    {
      label: "",
      className: "num",
      render: (p) => (
        <div className="adm-actions-cell">
          <button className="adm-link-btn" onClick={() => openEdit(p)}>{tx("Edit")}</button>
          <button className="adm-link-btn danger" onClick={() => setDeleteTarget(p)}>{tx("Delete")}</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tx("Investment Plans")}
        subtitle={tx("Plans power the earnings accrual engine. ROI is stored in basis points (bps) — 5% monthly = 500 bps.")}
        actions={
          <button className="adm-btn primary" onClick={openCreate}>{tx("+ New Plan")}</button>
        }
      />

      {error && data && <ErrorBanner message={error} onRetry={() => void load()} />}
      {loading && !data ? (
        <Spinner label={tx("Loading plans…")} />
      ) : error && !data ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : data ? (
        <DataTable columns={columns} rows={data} />
      ) : null}

      {editor && (
        <Modal busy={!!busy} title={editor.id ? tx("Edit \"{value0}\"", { value0: editor.name }) : tx("New Investment Plan")} onClose={() => !busy && setEditor(null)} wide>
          <div className="adm-grid-2">
            <Field label={tx("Plan name")}>
              <input className="adm-input" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder={tx("QFS Growth")} />
            </Field>
            <Field label={tx("Monthly ROI (%)")}>
              <div className="adm-input-suffix">
                <input
                  className="adm-input"
                  inputMode="decimal"
                  value={editor.monthlyRoiPct}
                  onChange={(e) => setEditor({ ...editor, monthlyRoiPct: e.target.value })}
                  placeholder={tx.number(5, {useGrouping:false,minimumFractionDigits:1})}
                />
                <span>%</span>
              </div>
            </Field>
            <Field label={tx("Minimum amount (USD)")}>
              <div className="adm-input-suffix">
                <input
                  className="adm-input"
                  inputMode="decimal"
                  value={editor.minAmount}
                  onChange={(e) => setEditor({ ...editor, minAmount: e.target.value })}
                />
                <span>$</span>
              </div>
            </Field>
            <Field label={tx("Maximum amount (USD, optional)")}>
              <div className="adm-input-suffix">
                <input
                  className="adm-input"
                  inputMode="decimal"
                  value={editor.maxAmount}
                  onChange={(e) => setEditor({ ...editor, maxAmount: e.target.value })}
                  placeholder={tx("Unlimited")}
                />
                <span>$</span>
              </div>
            </Field>
            <Field label={tx("Term (months)")}>
              <input
                className="adm-input"
                inputMode="numeric"
                value={editor.termMonths}
                onChange={(e) => setEditor({ ...editor, termMonths: e.target.value })}
              />
            </Field>
            <Field label={tx("Profit payout")}>
              <select
                className="adm-input"
                value={editor.payoutInterval}
                onChange={(e) => setEditor({ ...editor, payoutInterval: e.target.value as FormState["payoutInterval"] })}
              >
                <option value="MONTHLY">{tx("Accrue hourly, credit monthly")}</option>
                <option value="HOURLY">{tx("Credit spendable balance hourly")}</option>
              </select>
            </Field>
            <Field label={tx("Sort order")}>
              <input
                className="adm-input"
                inputMode="numeric"
                value={editor.sort}
                onChange={(e) => setEditor({ ...editor, sort: e.target.value })}
              />
            </Field>
            <Field label={tx("Principal release at maturity")}>
              <select className="adm-input" value={editor.principalRelease} onChange={(e) => setEditor({ ...editor, principalRelease: e.target.value as FormState["principalRelease"] })}>
                <option value="MANUAL">{tx("After admin approval")}</option>
                <option value="AUTOMATIC">{tx("Return automatically")}</option>
              </select>
              <span className="adm-note">{tx("Applies to new investments. Principal returns to available balance after the term and final profit payment.")}</span>
            </Field>
          </div>
          <Field label={tx("Description (shown to users)")}>
            <textarea
              className="adm-textarea"
              value={editor.description}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              placeholder={tx("A balanced plan for steady growth…")}
            />
          </Field>
          <Field label={tx("Supporting materials")}>
            <span className="adm-note">{tx("Existing investments keep their financial terms and any materials recorded at purchase.")}</span>
          </Field>
          <Field label={tx("Additional plan terms")}><textarea className="adm-textarea" rows={5} maxLength={10000} value={editor.terms} onChange={(e) => setEditor({ ...editor, terms: e.target.value })} placeholder={tx("Publish the plan’s conditions, including capital release and early exit rules.")} /></Field>
          <Field label={tx("Risk disclosure")}><textarea className="adm-textarea" rows={4} maxLength={10000} value={editor.riskDisclosure} onChange={(e) => setEditor({ ...editor, riskDisclosure: e.target.value })} /></Field>
          <PlanTranslationEditor materials={editor} versions={editor.translations} disabled={busy} onDirty={setTranslationDirty} onChange={(translations) => setEditor({ ...editor, translations })} />
          <Field label={tx("Supporting documents")}>
            {documents.error && <ErrorBanner message={documents.error} onRetry={documents.reload} />}
            {documents.loading && !documents.data && <Spinner label={tx("Loading documents…")} />}
            {documents.data?.length === 0 && <p className="adm-note">{tx("Upload documents in the Documents section, then attach them to this plan.")}</p>}
            {documents.data?.map((document) => <label key={document.id} className="adm-plan-document"><input type="checkbox" checked={editor.documentIds.includes(document.id)} onChange={(event) => setEditor({ ...editor, documentIds: event.target.checked ? [...editor.documentIds, document.id] : editor.documentIds.filter((id) => id !== document.id) })} />{tx(document.title)}{!document.isActive && <span>{tx("(inactive — not included in new investments)")}</span>}</label>)}
          </Field>
          <Field label={tx("Accent color")}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PLAN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={tx("Color {value0}", { value0: c })}
                  onClick={() => setEditor({ ...editor, color: c })}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: c,
                    border: editor.color === c ? "2px solid var(--dash-lime-2)" : "2px solid transparent",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          </Field>
          <label className="adm-check" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={editor.isActive}
              onChange={(e) => setEditor({ ...editor, isActive: e.target.checked })}
            />{tx("Active — users can invest in this plan")}</label>
          <div className="adm-row-end">
            <button className="adm-btn ghost" onClick={() => setEditor(null)} disabled={busy}>{tx("Cancel")}</button>
            <button className="adm-btn primary" onClick={save} disabled={busy || translationDirty}>
              {busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Saving…")}</> : editor.id ? tx("Save Changes") : tx("Create Plan")}
            </button>
          </div>
          {translationDirty && <p className="adm-note" role="status">{tx("Use or discard your translation edits before saving the plan.")}</p>}
        </Modal>
      )}

      {deleteTarget && (
        <Confirm
          title={tx("Delete \"{value0}\"?", { value0: deleteTarget.name })}
          text={
            deleteTarget ? (
              <>{tx("Plan min {value0} · {value1} months · ROI {value2}%. Plans with investment history are deactivated instead of hard-deleted; active history is preserved.", { value0: tx.money(deleteTarget.minAmountCents), value1: deleteTarget.termMonths, value2: tx.number(deleteTarget.monthlyRoiBps / 100, {minimumFractionDigits:1,maximumFractionDigits:2}) })}</>
            ) : undefined
          }
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
