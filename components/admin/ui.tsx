"use client";
import { useText } from "@/lib/i18n/text";


/* Shared client-side toolkit for the QFS admin dashboard. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LIVE_MS, useLive } from "@/lib/use-live";
import { Close } from "../dashboard/icons";
import { ActionToast, type FeedbackMessage } from "../ActionFeedback";
export type { FeedbackMessage } from "../ActionFeedback";

/* ---------------- API helpers ---------------- */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    if (res.status === 401) {
      window.location.href = "/admin/login";
      throw new Error("Session expired");
    }
    throw new Error(json?.error?.message ?? "Request failed");
  }
  return json.data as T;
}

export async function apiSend<T = unknown>(path: string, method: "POST" | "PATCH" | "DELETE" | "PUT", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    if (res.status === 401) {
      window.location.href = "/admin/login";
      throw new Error("Session expired");
    }
    throw new Error(json?.error?.message ?? "Request failed");
  }
  return json.data as T;
}

export function useFetch<T>(path: string, opts?: { intervalMs?: number }) {
  const activePath = useRef(path);
  activePath.current = path;
  const generation = useRef(0);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });

  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const d = await apiGet<T>(path);
      if (activePath.current !== path || current !== generation.current) return;
      setState({ data: d, error: null, loading: false });
    } catch (e) {
      if (activePath.current !== path || current !== generation.current) return;
      setState((s) => ({ data: s.data, error: (e as Error).message, loading: false }));
    }
  }, [path]);

  // Loads on mount and then keeps itself fresh. Pass { intervalMs: 0 } to opt out of polling.
  useEffect(() => {
    setState({data: null, error: null, loading: true});
    void reload();
    return () => { generation.current++; };
  }, [reload]);
  const syncedAt = useLive(reload, opts?.intervalMs ?? LIVE_MS, false);

  return { ...state, reload, syncedAt };
}

/* ---------------- Formatting ---------------- */

export function fmtMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------------- Tiny UI primitives ---------------- */

export function Spinner({ label = "Loading…" }: { label?: string }) {
  const tx = useText();
  return (
    <div className="adm-loading" role="status">
      <span className="adm-spinner" aria-hidden="true" />
      {tx(label)}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const tx = useText();
  return (
    <div className="adm-banner error" role="alert">
      <span>{tx(message)}</span>
      {onRetry && (
        <button className="adm-btn ghost sm" onClick={onRetry}>{tx("Retry")}</button>
      )}
    </div>
  );
}

export function EmptyState({ title = "Nothing here yet", hint }: { title?: string; hint?: string }) {
  const tx = useText();
  return (
    <div className="adm-empty">
      <b>{tx(title)}</b>
      {hint && <span>{tx(hint)}</span>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  const tx = useText();
  return (
    <div className="adm-page-head">
      <div>
        <h1>{tx(title)}</h1>
        {subtitle && <p>{tx(subtitle)}</p>}
      </div>
      {actions && <div className="adm-page-actions">{actions}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tx = useText();
  const cls = status.toLowerCase();
  const label = status.toLowerCase().replace(/_/g, " ");
  const labels: Record<string, string> = {EARNING:"Earning", REFERRAL_BONUS:"Referral Bonus", PRINCIPAL_RETURN:"Principal return", ADJUSTMENT:"Adjustment", SWAP:"Crypto swap"};
  return <span className={`adm-pill ${cls}`}>{tx(labels[label.toUpperCase().replace(/\s+/g,"_")] ?? (label.charAt(0).toUpperCase() + label.slice(1)))}</span>;
}

export function Modal({ title, onClose, children, wide, busy = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; busy?: boolean }) {
  const tx = useText();
  const dialog = useRef<HTMLDivElement>(null);
  const state = useRef({onClose, busy});
  state.current = {onClose, busy};
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus({preventScroll:true});
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); if (!state.current.busy) state.current.onClose(); }
      if (event.key !== "Tab" || !dialog.current) return;
      const controls = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']")]
        .filter(node => node.getClientRects().length && node.getAttribute("aria-disabled") !== "true");
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.current.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({preventScroll:true});
    };
  }, []);
  return (
    <div className="adm-modal-overlay" onClick={(e) => !busy && e.target === e.currentTarget && onClose()}>
      <div ref={dialog} tabIndex={-1} className={`adm-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-busy={busy} aria-label={tx(title)}>
        <div className="adm-modal-head">
          <h3>{tx(title)}</h3>
          {busy && <span className="adm-modal-progress" role="status"><span className="action-spinner" aria-hidden="true" />{tx("Working…")}</span>}
          <button className="adm-modal-close" aria-label={tx("Close")} disabled={busy} onClick={onClose}>
            <Close />
          </button>
        </div>
        <div className="adm-modal-body"><fieldset className="adm-modal-fieldset" disabled={busy}>{children}</fieldset></div>
      </div>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel = "Confirm", danger, busy, onConfirm, onCancel }: {
  title: string;
  text?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tx = useText();
  return (
    <Modal title={tx(title)} onClose={onCancel} busy={busy}>
      {text && <p className="adm-confirm-text">{text}</p>}
      <div className="adm-row-end">
        <button className="adm-btn ghost" onClick={onCancel} disabled={busy}>{tx("Cancel")}</button>
        <button
          className={`adm-btn ${danger ? "danger" : "primary"}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Working…")}</> : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const tx = useText();
  return (
    <div className="adm-field">
      <label>{tx(label)}</label>
      {children}
      {hint && <span className="adm-field-hint">{tx(hint)}</span>}
    </div>
  );
}

export function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  const tx = useText();
  return (
    <div className="adm-pagination">
      <span className="adm-pagination-total">{tx("{value0} row{value1} · page {value2} of {value3}", { value0: total, value1: tx(total === 1 ? "" : "s"), value2: page, value3: Math.max(totalPages, 1) })}</span>
      <div className="adm-pagination-btns">
        <button className="adm-btn ghost sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>{tx("← Prev")}</button>
        <button className="adm-btn ghost sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>{tx("Next →")}</button>
      </div>
    </div>
  );
}

export type Column<T> = { label: string; render: (row: T) => ReactNode; className?: string };

export function DataTable<T>({ columns, rows, empty }: { columns: Column<T>[]; rows: T[]; empty?: ReactNode }) {
  const tx = useText();
  if (rows.length === 0) {
    return empty ?? <EmptyState />;
  }
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={c.className}>
                {tx(c.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.label} className={c.className}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Toast({ message, onDone }: { message: FeedbackMessage | null; onDone: () => void }) {
  const tx = useText();
  return <ActionToast message={message} onDone={onDone}>{message && (typeof message === "string" || message.tone !== "error") && <a href="/admin/audit">{tx("View audit log")}</a>}</ActionToast>;
}
