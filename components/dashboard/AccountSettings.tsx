"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useText } from "@/lib/i18n/text";
import { ActionNotice } from "@/components/ActionFeedback";

type Snapshot = {
  user: { name: string; email: string; phone: string | null; country: string; role: string };
  twoFactorEnabled: boolean; recoveryCodesRemaining: number;
  sessions: { id: string; current: boolean; ipAddress: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string | null; expiresAt: string }[];
};
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error?.message ?? "Could not update your account. Please try again.");
  return result.data;
}

export default function AccountSettings({ onUpdated }: { onUpdated?: () => void }) {
  const tx = useText();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState<{size:number;path:string}|null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [revokeId, setRevokeId] = useState("");
  const lock = useRef(false);
  const load = useCallback(async () => setData(await request<Snapshot>("/api/account/security")), []);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  useEffect(() => {
    let alive = true;
    setQr(null);
    if (setup) void import("@/lib/qr-code").then(({qrcodegen}) => {
      const matrix = qrcodegen.QrCode.encodeText(setup.uri, qrcodegen.QrCode.Ecc.MEDIUM);
      let path = "";
      for (let y=0;y<matrix.size;y++) for (let x=0;x<matrix.size;x++) if (matrix.getModule(x,y)) path += `M${x+4} ${y+4}h1v1h-1z`;
      if (alive) setQr({size:matrix.size+8,path});
    }).catch(() => {});
    return () => { alive = false; };
  }, [setup]);

  async function submit(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setBusy(action); setError(""); setMessage(""); setCodes([]);
    try {
      if (action === "profile") {
        await request("/api/account/profile", "PATCH", values);
        setMessage("Profile saved."); onUpdated?.();
      } else if (action === "password") {
        await request("/api/account/password", "POST", values);
        form.reset(); setSetup(null);
        setMessage("Password changed. Other devices have been signed out.");
      } else if (action === "setup") {
        setSetup(await request("/api/account/two-factor/setup", "POST", values));
        form.reset();
      } else if (action === "revoke") {
        await request(`/api/account/sessions/${encodeURIComponent(revokeId)}`, "DELETE", values);
        setRevokeId(""); form.reset(); setMessage("Selected sessions signed out.");
      } else {
        const result = await request<{ recoveryCodes: string[] }>("/api/account/two-factor", "POST", { ...values, action });
        setCodes(result.recoveryCodes); setSetup(null); form.reset();
        setMessage(action === "DISABLE" ? "Two-factor authentication disabled. Other devices have been signed out." : "Security updated. Save your recovery codes somewhere private.");
      }
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); lock.current = false; }
  }

  const proof = (id: string, factor = data?.twoFactorEnabled) => <>
    <label className="dash-form-group" htmlFor={`${id}-password`}><span>{tx("Current password")}</span><input id={`${id}-password`} className="dash-input" type="password" name="currentPassword" autoComplete="current-password" required maxLength={200} /></label>
    {factor && <label className="dash-form-group" htmlFor={`${id}-code`}><span>{tx("Authenticator or recovery code")}</span><input id={`${id}-code`} className="dash-input" name="code" dir="ltr" autoComplete="one-time-code" required maxLength={30} spellCheck={false} autoCapitalize="characters" /></label>}
  </>;
  const button = (action: string, label: string) => <button className="dash-btn primary" disabled={!!busy} type="submit">{busy === action ? <><span className="action-spinner" aria-hidden="true" />{tx("Saving…")}</> : tx(label)}</button>;

  return <div className="account-settings" aria-busy={!!busy}>
    {error && <p className="dash-form-error" role="alert">{tx(error)}{!data && <button className="dash-btn ghost" onClick={() => { setError(""); void load().catch(e => setError(e.message)); }}>{tx("Retry")}</button>}</p>}
    {message && <ActionNotice message={message} />}
    {!data ? !error && <p role="status"><span className="action-spinner" aria-hidden="true" /> {tx("Loading account settings…")}</p> : <>
      <section><header><h2>{tx("Profile")}</h2><p>{tx("Your display details. Verified identity details are managed through identity verification.")}</p></header>
        <form onSubmit={e => void submit(e, "profile")}><fieldset disabled={!!busy}>
          <div className="account-form-grid">
            <label className="dash-form-group" htmlFor="profile-name"><span>{tx("Display name")}</span><input id="profile-name" className="dash-input" name="name" defaultValue={data.user.name} autoComplete="name" minLength={2} maxLength={120} required /></label>
            <label className="dash-form-group" htmlFor="profile-phone"><span>{tx("Phone number")}</span><input id="profile-phone" className="dash-input" name="phone" type="tel" defaultValue={data.user.phone ?? ""} autoComplete="tel" maxLength={24} /></label>
            <label className="dash-form-group" htmlFor="profile-country"><span>{tx("Country")}</span><input id="profile-country" className="dash-input" name="country" defaultValue={data.user.country} autoComplete="country-name" minLength={2} maxLength={80} required /></label>
            <label className="dash-form-group" htmlFor="profile-email"><span>{tx("Email address")}</span><input id="profile-email" className="dash-input" type="email" value={data.user.email} readOnly /></label>
          </div>{button("profile", "Save profile")}
        </fieldset></form>
      </section>
      <section><header><h2>{tx("Password")}</h2><p>{tx("Changing your password signs out your other devices.")}</p></header>
        <form onSubmit={e => void submit(e, "password")}><fieldset disabled={!!busy}>
          {proof("change")}
          <div className="account-form-grid">{["password", "confirmPassword"].map((name, index) => <label key={name} className="dash-form-group" htmlFor={`change-${name}`}><span>{tx(index ? "Confirm new password" : "New password")}</span><input id={`change-${name}`} className="dash-input" name={name} type="password" autoComplete="new-password" minLength={10} maxLength={72} required /></label>)}</div>
          <p className="account-hint">{tx("Use at least 10 characters, including a letter and a number.")}</p>{button("password", "Change password")}
        </fieldset></form>
      </section>
      <section><header><h2>{tx("Two-factor authentication")}</h2><p>{tx(data.twoFactorEnabled ? "Enabled. Sign-in requires your password and an authenticator or recovery code." : "Add an authenticator app to protect your account. Recommended for administrators.")}</p></header>
        {codes.length > 0 && <div className="account-recovery"><strong>{tx("Save these recovery codes now")}</strong><p>{tx("Each code works once. These codes will not be displayed again.")}</p><div>{codes.map(code => <code key={code} dir="ltr">{code}</code>)}</div><button type="button" className="dash-btn ghost" onClick={() => {
          const blob = new Blob([tx("QFS recovery codes") + "\n\n" + codes.join("\n")], {type:"text/plain"}); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "qfs-recovery-codes.txt"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>{tx("Download recovery codes")}</button><button className="dash-btn ghost" onClick={() => setCodes([])}>{tx("I have saved my codes")}</button></div>}
        {!data.twoFactorEnabled ? setup ? <>
          <p>{tx("Scan this code in your authenticator app, or enter the setup key manually. Setup expires in 10 minutes.")}</p>
          <div className="account-setup">{qr && <svg role="img" aria-label={tx("Authenticator setup QR code")} width={200} height={200} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d={qr.path} fill="#000"/></svg>}<code dir="ltr">{setup.secret}</code></div>
          <form onSubmit={e => void submit(e, "ENABLE")}><fieldset disabled={!!busy}>{proof("enable", true)}{button("ENABLE", "Enable two-factor authentication")}<button className="dash-btn ghost" type="button" onClick={() => setSetup(null)}>{tx("Cancel")}</button></fieldset></form>
        </> : <form onSubmit={e => void submit(e, "setup")}><fieldset disabled={!!busy}>{proof("setup", false)}{button("setup", "Set up authenticator")}</fieldset></form> : <>
          <p className="account-hint">{tx("Recovery codes remaining: {count}", {count: data.recoveryCodesRemaining})}</p>
          <details><summary>{tx("Manage two-factor authentication")}</summary>
            <form onSubmit={e => void submit(e, (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? "RECOVERY_CODES")}><fieldset disabled={!!busy}>{proof("manage")}
              <button className="dash-btn ghost" type="submit" value="RECOVERY_CODES" disabled={!!busy}>{tx("Replace recovery codes")}</button>
              <button className="dash-btn ghost" type="submit" value="DISABLE" disabled={!!busy}>{tx("Disable two-factor authentication")}</button>
            </fieldset></form>
          </details>
        </>}
      </section>
      <section><header><h2>{tx("Active sessions")}</h2><p>{tx("Review where your account is signed in. Device details are reported by the browser.")}</p></header>
        <ul className="account-sessions">{data.sessions.map(session => <li key={session.id}><div><strong>{session.current ? tx("This device") : tx("Other device")}</strong><span>{session.userAgent || tx("Device details unavailable")}</span><small>{session.ipAddress || "—"} · {tx("Last active")} {tx.date(session.lastSeenAt ?? session.createdAt)}</small></div>{!session.current && <button className="dash-btn ghost" disabled={!!busy} onClick={() => setRevokeId(session.id)}>{tx("Sign out device")}</button>}</li>)}</ul>
        {data.sessions.some(session => !session.current) && <button className="dash-btn ghost" disabled={!!busy} onClick={() => setRevokeId("others")}>{tx("Sign out other devices")}</button>}
        {revokeId && <form onSubmit={e => void submit(e, "revoke")}><fieldset disabled={!!busy}><h3>{tx("Confirm session sign-out")}</h3>{proof("revoke")}{button("revoke", "Confirm sign out")}<button className="dash-btn ghost" type="button" onClick={() => setRevokeId("")}>{tx("Cancel")}</button></fieldset></form>}
      </section>
    </>}
  </div>;
}
