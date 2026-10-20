"use client";
import type { FeedbackMessage } from "@/components/ActionFeedback";
import { useText } from "@/lib/i18n/text";


import { useCallback, useState } from "react";
import { useLive } from "@/lib/use-live";
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
} from "@/components/admin/ui";
import { Star } from "@/components/dashboard/icons";

type Review = {
  id: string;
  userName: string;
  country: string;
  avatarUrl: string;
  rating: number;
  text: string;
  status: string;
  sort: number;
};

const EMPTY: Omit<Review, "id"> = { userName: "", country: "", avatarUrl: "", rating: 5, text: "", status: "APPROVED", sort: 0 };

export default function AdminReviewsPage() {
  const tx = useText();
  const [data, setData] = useState<Review[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<(Review & { isNew: boolean }) | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<FeedbackMessage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<Review[]>("/api/admin/reviews"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useLive(load);

  const save = async () => {
    if (!editor) return;
    if (!editor.userName.trim() || !editor.text.trim()) {
      setToast({message: "Name and review text are required", tone: "error"});
      return;
    }
    const body = {
      userName: editor.userName.trim(),
      country: editor.country.trim(),
      avatarUrl: editor.avatarUrl.trim(),
      rating: Math.max(1, Math.min(5, Math.round(editor.rating))),
      text: editor.text.trim(),
      status: editor.status,
      sort: Math.round(Number(editor.sort) || 0),
    };
    setBusy(true);
    try {
      if (editor.isNew) {
        await apiSend("/api/admin/reviews", "POST", body);
        setToast("Review published");
      } else {
        await apiSend(`/api/admin/reviews/${editor.id}`, "PATCH", body);
        setToast("Review updated");
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
      await apiSend(`/api/admin/reviews/${deleteTarget.id}`, "DELETE");
      setToast("Review deleted");
      setDeleteTarget(null);
      load();
    } catch (e) {
      setToast({message: (e as Error).message, tone: "error"});
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Review>[] = [
    {
      label: "Reviewer",
      render: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src={r.avatarUrl || "/avatars/avatar1.jpg"}
            alt=""
            style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }}
            onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.3")}
          />
          <div>
            <b>{r.userName}</b>
            <span className="adm-cell-sub">{r.country || "—"}</span>
          </div>
        </div>
      ),
    },
    {
      label: "Rating",
      render: (r) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--dash-gold)" }}>
          {r.rating} <Star size={13} />
        </span>
      ),
    },
    {
      label: "Text",
      render: (r) => (
        // the cell is truncated to keep the table narrow; title exposes the
        // full text on hover / long-press so nothing is unreadable
        <span
          className="adm-truncate"
          title={r.text}
        >
          {r.text}
        </span>
      ),
    },
    { label: "Status", render: (r) => <StatusPill status={r.status} /> },
    {
      label: "",
      className: "num",
      render: (r) => (
        <div className="adm-actions-cell">
          <button className="adm-link-btn" onClick={() => setEditor({ ...r, isNew: false })}>{tx("Edit")}</button>
          <button className="adm-link-btn danger" onClick={() => setDeleteTarget(r)}>{tx("Delete")}</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tx("Reviews")}
        subtitle={tx("Testimonials shown in the user dashboard. Only APPROVED reviews are visible to users.")}
        actions={
          <button className="adm-btn primary" onClick={() => setEditor({ id: "", ...EMPTY, isNew: true })}>{tx("+ New Review")}</button>
        }
      />

      {error && data && <ErrorBanner message={error} onRetry={() => void load()} />}
      {loading && !data ? (
        <Spinner label={tx("Loading reviews…")} />
      ) : error && !data ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : data ? (
        <DataTable columns={columns} rows={data} />
      ) : null}

      {editor && (
        <Modal busy={!!busy} title={editor.isNew ? tx("New Review") : tx("Edit {value0}", { value0: editor.userName })} onClose={() => !busy && setEditor(null)} wide>
          <div className="adm-grid-2">
            <Field label={tx("Reviewer name")}>
              <input className="adm-input" value={editor.userName} onChange={(e) => setEditor({ ...editor, userName: e.target.value })} />
            </Field>
            <Field label={tx("Country")}>
              <input className="adm-input" value={editor.country} onChange={(e) => setEditor({ ...editor, country: e.target.value })} placeholder={tx("Ghana")} />
            </Field>
          </div>
          <Field label={tx("Avatar URL")}>
            <input className="adm-input" value={editor.avatarUrl} onChange={(e) => setEditor({ ...editor, avatarUrl: e.target.value })} placeholder="/avatars/avatar1.jpg" />
          </Field>
          <Field label={tx("Review text")}>
            <textarea className="adm-textarea" value={editor.text} onChange={(e) => setEditor({ ...editor, text: e.target.value })} />
          </Field>
          <div className="adm-grid-2">
            <Field label={tx("Rating (1–5)")}>
              <input className="adm-input" inputMode="numeric" type="number" min={1} max={5} value={editor.rating} onChange={(e) => setEditor({ ...editor, rating: Number(e.target.value) })} />
            </Field>
            <Field label={tx("Sort")}>
              <input className="adm-input" inputMode="numeric" value={String(editor.sort)} onChange={(e) => setEditor({ ...editor, sort: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <Field label={tx("Status")}>
            <select className="adm-select" value={editor.status} onChange={(e) => setEditor({ ...editor, status: e.target.value })}>
              <option value="APPROVED">{tx("Approved (visible)")}</option>
              <option value="HIDDEN">{tx("Hidden")}</option>
            </select>
          </Field>
          <div className="adm-row-end">
            <button className="adm-btn ghost" onClick={() => setEditor(null)} disabled={busy}>{tx("Cancel")}</button>
            <button className="adm-btn primary" onClick={save} disabled={busy}>
              {busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Saving…")}</> : editor.isNew ? tx("Publish") : tx("Save Changes")}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Confirm
          title={tx("Delete this review?")}
          text={tx("Remove the review by {value0}?", { value0: deleteTarget.userName })}
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