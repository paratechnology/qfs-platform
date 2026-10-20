"use client";
import { SUPPORT_HREF } from "@/lib/site";

import { useText } from "@/lib/i18n/text";


import { useEffect, useRef, useState, type FormEvent } from "react";
import AuthLayout, { AuthField, AuthLink } from "./AuthLayout";
import PasswordField from "./PasswordField";
import { ArrowRight, Lock, Mail } from "./icons";

export default function AccountRecovery({ reset = false }: { reset?: boolean }) {
  const tx = useText();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const inFlight = useRef(false);
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const readToken = () => {
      if (!reset) return;
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      setToken(value && /^[a-f0-9]{64}$/.test(value) ? value : null);
      setError("");
      setSuccess(false);
    };
    readToken();
    setReady(true);
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, [reset]);
  useEffect(() => { if (error || success) messageRef.current?.focus(); }, [error, success]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || (reset && !token)) return;
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (reset && body.password !== body.confirmPassword) { setError("Passwords do not match."); return; }
    if (reset) body.token = token!;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(reset ? "/api/auth/reset-password" : "/api/auth/forgot-password", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error?.message ?? "Could not complete this request. Please try again.");
      if (reset) { form.reset(); window.history.replaceState(null, "", window.location.pathname); setToken(null); }
      setSuccess(true);
    } catch (e) { setError((e as Error).message === "Failed to fetch" ? "Connection lost. Please try again." : (e as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const content = success ? <div className="auth-recovery-result" ref={messageRef} tabIndex={-1} role="status">
    <h2>{tx(reset ? "Password changed" : "Check your email")}</h2>
    <p>{tx(reset ? "Your existing sessions have been signed out. Sign in with your new password." : "If an active account matches this email, look for a password reset link. Check your spam folder too. The link expires in 30 minutes.")}</p>
    {reset ? <AuthLink href="/user/user/login">{tx("Sign in")}<ArrowRight size={16} /></AuthLink> : <>
      <p>{tx("If the email does not arrive, try again or contact support.")}</p>
      <button type="button" className="auth-link auth-recovery-again" onClick={() => setSuccess(false)}>{tx("Send another link")}</button>
    </>}
  </div> : !ready ? <p className="auth-recovery-note" role="status">{tx(reset ? "Opening recovery link…" : "Opening account recovery…")}</p> : reset && !token ? <div className="auth-recovery-result" role="alert">
    <h2>{tx("Recovery link missing")}</h2><p>{tx("Open the complete link from your recovery email, or request a new one.")}</p><AuthLink href="/forgot-password">{tx("Request a new link")}<ArrowRight size={16} /></AuthLink>
  </div> : <form className="auth-form" method="post" onSubmit={submit}>
    <fieldset className="auth-recovery-fields" disabled={busy}>
      {reset ? <>
        <PasswordField label={tx("New password")} id="recovery-password" name="password" autoComplete="new-password" icon={<Lock />} />
        <PasswordField label={tx("Confirm new password")} id="recovery-confirm" name="confirmPassword" autoComplete="new-password" icon={<Lock />} />
        <p className="auth-recovery-note">{tx("Use 10–72 characters, including a letter and a number. After reset, you’ll need to sign in again.")}</p>
      </> : <AuthField label={tx("Email address")} type="email" id="recovery-email" name="email" autoComplete="email" placeholder="you@example.com" icon={<Mail />} />}
      {error && <div ref={messageRef} tabIndex={-1} className="auth-form-error" role="alert">{tx(error)}</div>}
      <button className="auth-submit" type="submit" disabled={busy}>{busy ? <><span className="auth-submit-spinner" aria-hidden="true" />{tx(reset ? "Changing password…" : "Requesting link…")}</> : <>{tx(reset ? "Set new password" : "Send recovery link")}<ArrowRight size={16} /></>}</button>
    </fieldset>
    {reset && <AuthLink href="/forgot-password">{tx("Link expired? Request a new one")}</AuthLink>}
  </form>;

  return <AuthLayout eyebrow={tx("Account recovery")} title={tx(reset ? "Set a New Password" : "Forgot Your Password?")} subtitle={tx(reset ? "Choose a new password for your QFS account." : "Enter your account email to request a private recovery link.")} submitLabel={tx("Continue")} formContent={content} footer={<p><AuthLink href="/user/user/login">{tx("Back to sign in")}</AuthLink> · <a className="auth-link" href={`${SUPPORT_HREF}?subject=Account%20recovery`}>{tx("Contact support")}</a></p>} />;
}
