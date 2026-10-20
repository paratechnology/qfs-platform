"use client";
import { SUPPORT_HREF } from "@/lib/site";


import { useEffect, useRef, type ReactNode } from "react";
import { useText } from "@/lib/i18n/text";

export type FeedbackMessage = string | {
  message: string;
  tone?: "success" | "error" | "info";
  description?: string;
};

export function ActionNotice({ message, tone = "success", children }: {
  message: string; tone?: "success" | "error" | "info"; children?: ReactNode;
}) {
  const tx = useText();
  return <div className={`action-notice ${tone}`} role={tone === "error" ? "alert" : "status"} aria-atomic="true">
    <span className="action-feedback-icon" aria-hidden="true">{tone === "success" ? "✓" : tone === "error" ? "!" : "i"}</span>
    <div><p>{tx(message)}</p>{children}</div>
  </div>;
}

export function ActionToast({ message, onDone, children }: {
  message: FeedbackMessage | null; onDone: () => void; children?: ReactNode;
}) {
  const tx = useText();
  const dismiss = useRef(onDone);
  dismiss.current = onDone;
  const tone = typeof message === "string" ? "success" : message?.tone ?? "success";
  useEffect(() => {
    if (!message || tone === "error") return;
    const timer = setTimeout(() => dismiss.current(), 8000);
    return () => clearTimeout(timer);
  }, [message, tone]);
  if (!message) return null;
  const content = typeof message === "string" ? { message } : message;
  return <div className={`action-toast ${tone}`} role={tone === "error" ? "alert" : "status"} aria-atomic="true">
    <span className="action-feedback-icon" aria-hidden="true">{tone === "success" ? "✓" : tone === "error" ? "!" : "i"}</span>
    <div className="action-feedback-content"><p>{tx(content.message)}</p>
      {content.description && <small>{tx(content.description)}</small>}
      {children}
      {tone === "error" && <a href={SUPPORT_HREF}>{tx("Contact support for more information")}</a>}
    </div>
    <button type="button" onClick={onDone} aria-label={tx("Dismiss confirmation")} className="action-feedback-dismiss">×</button>
  </div>;
}

export function PageLoading() {
  const tx = useText();
  return <div className="page-loading" role="status" aria-live="polite"><span className="action-spinner" aria-hidden="true" />{tx("Loading…")}</div>;
}
