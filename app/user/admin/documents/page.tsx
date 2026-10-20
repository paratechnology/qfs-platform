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

type Doc = {
  id: string;
  code: string;
  title: string;
  flagPath: string;
  fileUrl: string;
  sort: number;
  isActive: boolean;
};

const EMPTY: Omit<Doc, "id"> = { code: "", title: "", flagPath: "", fileUrl: "", sort: 0, isActive: true };

export default function AdminDocumentsPage() {
  const tx = useText();
  const [data, setData] = useState<Doc[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<(Doc & { isNew: boolean }) | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<FeedbackMessage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<Doc[]>("/api/admin/documents"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useLive(load);

  const save = async () => {
    if (!editor) return;
    if (!editor.code.trim() || !editor.title.trim() || !editor.flagPath.trim() || (!selectedFile && !editor.fileUrl.trim())) {
      setToast({message: "Enter the document details and choose a PDF or file URL", tone: "error"});
      return;
    }
    if (selectedFile && selectedFile.size > 10 * 1024 * 1024) {
      setToast({message: "PDF files must be 10 MB or smaller", tone: "error"});
      return;
    }
    const body = {
      code: editor.code.trim(),
      title: editor.title.trim(),
      flagPath: editor.flagPath.trim(),
      fileUrl: editor.fileUrl.trim(),
      sort: Math.round(Number(editor.sort) || 0),
      isActive: editor.isActive,
    };
    setBusy(true);
    try {
      if (selectedFile) {
        const form = new FormData();
        if (!editor.isNew) form.append("id", editor.id);
        form.append("code", body.code);
        form.append("title", body.title);
        form.append("flagPath", body.flagPath);
        form.append("sort", String(body.sort));
        form.append("isActive", body.isActive ? "1" : "0");
        form.append("file", selectedFile);
        const response = await fetch("/api/admin/documents/upload", { method: "POST", body: form });
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok) throw new Error(json?.error?.message ?? "PDF upload failed");
        setToast(tx(editor.isNew ? "Document \"{code}\" created" : "Document \"{code}\" updated", {code:body.code}));
      } else if (editor.isNew) {
        await apiSend("/api/admin/documents", "POST", body);
        setToast(tx("Document \"{code}\" created", {code:body.code}));
      } else {
        await apiSend(`/api/admin/documents/${editor.id}`, "PATCH", body);
        setToast(tx("Document \"{code}\" updated", {code:body.code}));
      }
      setEditor(null);
      setSelectedFile(null);
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
      await apiSend(`/api/admin/documents/${deleteTarget.id}`, "DELETE");
      setToast(tx("Document \"{code}\" deleted", {code:deleteTarget.code}));
      setDeleteTarget(null);
      load();
    } catch (e) {
      setToast({message: (e as Error).message, tone: "error"});
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Doc>[] = [
    {
      label: "Doc",
      render: (d) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img className="adm-flag" src={d.flagPath} alt="" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.3")} />
          <div>
            <b>{d.code}</b>
            <span className="adm-cell-sub">{tx(d.title)}</span>
          </div>
        </div>
      ),
    },
    { label: "Sort", render: (d) => d.sort },
    { label: "Status", render: (d) => <StatusPill status={d.isActive ? "Active" : "Disabled"} /> },
    {
      label: "",
      className: "num",
      render: (d) => (
        <div className="adm-actions-cell">
          <button className="adm-link-btn" onClick={() => { setSelectedFile(null); setEditor({ ...d, isNew: false }); }}>{tx("Edit")}</button>
          <button className="adm-link-btn danger" onClick={() => setDeleteTarget(d)}>{tx("Delete")}</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tx("Documents")}
        subtitle={tx("PDF resources shown in the user dashboard Resources tab.")}
        actions={
          <button className="adm-btn primary" onClick={() => { setSelectedFile(null); setEditor({ id: "", ...EMPTY, isNew: true }); }}>{tx("+ New Document")}</button>
        }
      />

      {error && data && <ErrorBanner message={error} onRetry={() => void load()} />}
      {loading && !data ? (
        <Spinner label={tx("Loading documents…")} />
      ) : error && !data ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : data ? (
        <DataTable columns={columns} rows={data} />
      ) : null}

      {editor && (
        <Modal busy={!!busy} title={editor.isNew ? tx("New Document") : tx("Edit {value0}", { value0: editor.code })} onClose={() => !busy && setEditor(null)}>
          <Field label={tx("Code")}>
            <input className="adm-input" value={editor.code} onChange={(e) => setEditor({ ...editor, code: e.target.value })} placeholder="QFS-OVERVIEW" />
          </Field>
          <Field label={tx("Title")}>
            <input className="adm-input" value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} placeholder={tx("Company Presentation")} />
          </Field>
          <Field label={tx("Flag image path")}>
            <input className="adm-input" value={editor.flagPath} onChange={(e) => setEditor({ ...editor, flagPath: e.target.value })} placeholder="/flags/uk.svg" />
          </Field>
          <Field label={tx("File URL (PDF)")}>
            <input className="adm-input" value={editor.fileUrl} onChange={(e) => setEditor({ ...editor, fileUrl: e.target.value })} placeholder="/docs/qfs-overview.pdf" />
          </Field>
          <Field label={tx("Or upload a PDF (10 MB max)")}>
            <input className="adm-input" type="file" accept=".pdf,application/pdf" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
          </Field>
          {selectedFile && <p className="adm-cell-sub">{tx("Selected: {value0}. This upload replaces the file URL when saved.", { value0: selectedFile.name })}</p>}
          <div className="adm-grid-2">
            <Field label={tx("Sort")}>
              <input className="adm-input" inputMode="numeric" value={String(editor.sort)} onChange={(e) => setEditor({ ...editor, sort: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={tx("Status")}>
              <select className="adm-select" value={editor.isActive ? "active" : "disabled"} onChange={(e) => setEditor({ ...editor, isActive: e.target.value === "active" })}>
                <option value="active">{tx("Active")}</option>
                <option value="disabled">{tx("Disabled")}</option>
              </select>
            </Field>
          </div>
          <div className="adm-row-end">
            <button className="adm-btn ghost" onClick={() => setEditor(null)} disabled={busy}>{tx("Cancel")}</button>
            <button className="adm-btn primary" onClick={save} disabled={busy}>
              {busy ? <><span className="action-spinner" aria-hidden="true" />{tx("Saving…")}</> : editor.isNew ? tx("Create") : tx("Save Changes")}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Confirm
          title={tx("Delete \"{value0}\"?", { value0: deleteTarget.code })}
          text={tx("This permanently removes the document from the platform.")}
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
