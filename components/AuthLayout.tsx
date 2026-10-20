"use client";
import { SUPPORT_HREF } from "@/lib/site";

import { useText } from "@/lib/i18n/text";


import Reveal from "./Reveal";
import { ArrowRight } from "./icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import LanguageSelector from "./LanguageSelector";
import { ActionNotice } from "./ActionFeedback";

/* ---------- Shared auth page shell (login + register) ----------
   Immersive dark split layout: brand panel + form card. */

const AUTH_AVATARS = [
  "/avatars/avatar4.jpg",
  "/avatars/avatar1.jpg",
  "/avatars/avatar2.jpg",
  "/avatars/avatar3.jpg",
];

type AuthLayoutProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
  formContent?: ReactNode;
  submitLabel: string;
  footer: ReactNode;
  /** Fallback redirect target when no API endpoint is provided. */
  to?: string;
  /** Real auth API endpoint (e.g. /api/auth/login). Submits the form to it. */
  endpoint?: string;
};

export default function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  submitLabel,
  footer,
  to,
  endpoint,
  formContent,
}: AuthLayoutProps) {
  const tx = useText();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [registered, setRegistered] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const inFlight = useRef(false);
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (registered) successRef.current?.focus(); }, [registered]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    setError(null);

    if (!endpoint) {
      if (to) router.push(to);
      return;
    }

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    if (endpoint === "/api/auth/register") {
      let storedReferral: string | null = null;
      try { storedReferral = sessionStorage.getItem("qfs_referral_code"); } catch { /* Storage is optional. */ }
      const referralCode = new URLSearchParams(window.location.search).get("ref") ?? storedReferral;
      if (referralCode) data.referralCode = referralCode;
    }

    // Client-side password match check for register.
    if (data.password && data.confirmPassword && data.password !== data.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    inFlight.current = true;
    setBusy(true);
    let redirecting = false;
    try {
      const res = await fetch(challenge ? "/api/auth/two-factor" : endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(challenge ? { challenge, code: data.code } : data),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setError(json?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }

      if (json.data?.twoFactorRequired) {
        setChallenge(json.data.challenge);
        form.reset();
        return;
      }
      const role = json.data?.user?.role;
      if (endpoint === "/api/auth/register") {
        try { sessionStorage.removeItem("qfs_referral_code"); } catch { /* Registration has already succeeded. */ }
        form.reset();
        setRegistered(true);
        router.refresh();
        return;
      }
      redirecting = true;
      setSignedIn(true);
      router.push(role === "ADMIN" ? "/admin" : (to ?? "/user/user/dashboard"));
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      if (!redirecting) { setBusy(false); inFlight.current = false; }
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-glow auth-glow-one" aria-hidden="true" />
      <div className="auth-glow auth-glow-two" aria-hidden="true" />
      <div className="auth-pattern" aria-hidden="true" />
      <div className="auth-shell">
        <Reveal animation="fadeInUp" duration={900}>
          <div className="auth-frame">
            {/* Left: brand panel (desktop) */}
            <aside className="auth-panel">
              <img
                src="/logo/logo_Asset-5-1024x318-1.png"
                alt="QFS"
                className="auth-logo"
                width={172}
                height={54}
              />

              <div className="auth-panel-body">
                <span className="label label-accent">{tx("Quantum Financial System")}</span>
                <h2>{tx("Your Financial Freedom Begins Here")}</h2>
                <p>{tx("Unlock your financial freedom with QFS. Discover innovative solutions for secure and efficient financial management.")}</p>
              </div>

              <div className="auth-panel-proof">
                <div className="auth-proof-users">
                  <div className="auth-avatars">
                    {AUTH_AVATARS.map((src) => (
                      <img
                        key={src}
                        className="avatar"
                        src={src}
                        alt=""
                        width={40}
                        height={40}
                      />
                    ))}
                  </div>
                  <div className="auth-proof-text">
                    <strong>12.5M+</strong>
                    <span>{tx("World Enrolled Users")}</span>
                  </div>
                </div>
                <div className="auth-proof-award">
                  <img src="/award/award_Asset-6-2.png" alt="" width={40} height={36} />
                  <p>{tx("2025's Best QFS Platform")}</p>
                </div>
              </div>

              <img
                src="/cards/cc1-1-1024x869-1.png"
                alt=""
                className="auth-panel-card"
                width={420}
                height={356}
              />
            </aside>

            {/* Right: form card */}
            <section className="auth-card">
              <div className="auth-language"><LanguageSelector /></div>
              <div className="auth-mobile-brand">
                <img
                  src="/logo/logo_Asset-5-1024x318-1.png"
                  alt="QFS"
                  className="auth-logo"
                  width={150}
                  height={47}
                />
              </div>

              <Reveal delay={120} animation="fadeInUp" duration={900}>
                <div className="auth-head">
                  <span className="label label-accent">{tx(eyebrow)}</span>
                  <h1>{tx(title)}</h1>
                  <p>{tx(subtitle)}</p>
                </div>
              </Reveal>

              <Reveal delay={240} animation="fadeInUp" duration={900}>
                {formContent ?? (registered ? <div ref={successRef} tabIndex={-1} className="auth-success">
                  <ActionNotice message="Account registration successful.">
                    <p>{tx("Sign in with your email address and password to access your account.")}</p>
                    <AuthLink href="/user/user/login">{tx("Click here to log in")}<ArrowRight size={16} /></AuthLink>
                  </ActionNotice>
                </div> : <form className="auth-form" method="post" noValidate aria-busy={busy} onSubmit={handleSubmit}>
                  <fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
                  {challenge ? <>
                    <p>{tx("Enter the code from your authenticator app, or use an unused recovery code.")}</p>
                    <label className="auth-field" htmlFor="login-factor">{tx("Authenticator or recovery code")}</label>
                    <div className="auth-input"><input id="login-factor" name="code" dir="ltr" autoComplete="one-time-code" required maxLength={30} autoFocus /></div>
                  </> : children}

                  {error && (
                    <p className="auth-form-error" role="alert">
                      {tx(error)}
                    </p>
                  )}

                  <button type="submit" className="auth-submit" disabled={busy}>
                    {busy ? <><span className="action-spinner" aria-hidden="true" />{tx(signedIn ? "Signed in. Opening your dashboard…" : endpoint === "/api/auth/register" ? "Creating account…" : "Signing in…")}</> : <>{challenge ? tx("Verify and sign in") : submitLabel}<ArrowRight size={16} /></>}
                  </button>
                  {challenge && <button type="button" className="auth-link" onClick={() => { setChallenge(""); setError(null); }}>{tx("Back to sign in")}</button>}
                  </fieldset>
                </form>)}
              </Reveal>

              <div className="auth-footer">{registered ? <a className="auth-link" href={SUPPORT_HREF}>{tx("Contact support for more information")}</a> : footer}</div>
            </section>
          </div>
        </Reveal>
      </div>
    </main>
  );
}

/* ---------- Reusable form field ---------- */

type FieldProps = {
  label: string;
  type?: string;
  id: string;
  name: string;
  placeholder?: string;
  autoComplete?: string;
  icon?: ReactNode;
  right?: ReactNode;
  error?: string;
  /** Render a <select> (country picker) instead of a text input. */
  select?: boolean;
  options?: string[];
};

export function AuthField({
  label,
  type = "text",
  id,
  name,
  placeholder,
  autoComplete,
  icon,
  right,
  error,
  select,
  options,
}: FieldProps) {
  const tx = useText();
  return (
    <Reveal delay={400} animation="fadeInUp" duration={900}>
      <div className={`auth-field${error ? " has-error" : ""}`}>
        <label htmlFor={id}>{tx(label)}</label>
        <div className="auth-input">
          {icon && <span className="auth-input-icon">{icon}</span>}
          {select ? (
            <select
              id={id}
              name={name}
              required
              defaultValue=""
              className="auth-select"
            >
              <option value="" disabled>
                {placeholder ?? tx("Select…")}
              </option>
              {options?.map((o) => (
                <option key={o} value={o}>
                  {tx(o)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={id}
              name={name}
              type={type}
              placeholder={tx(placeholder)}
              autoComplete={autoComplete}
              required
            />
          )}
          {right && <span className="auth-input-right">{right}</span>}
        </div>
        {error && <p className="auth-msg">{tx(error)}</p>}
      </div>
    </Reveal>
  );
}

/* ---------- Inline auth footer link ---------- */

export function AuthLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="auth-link">
      {children}
    </Link>
  );
}

/* ---------- Named alias the login/register pages rely on ---------- */

/** Alias so pages can write <Field … /> (matches the original Elementor markup). */
export { AuthField as Field };
