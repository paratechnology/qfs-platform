"use client";
import { useText } from "@/lib/i18n/text";


import { useEffect, useRef, useState, type ReactNode } from "react";
import Reveal from "./Reveal";

/* Loose format check mirrors zod's email rule closely enough for inline UX;
   the server re-validates with the strict schema on submit. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type EmailFieldProps = {
  label: string;
  id: string;
  name: string;
  placeholder?: string;
  autoComplete?: string;
  icon?: ReactNode;
};

/**
 * Email input with inline validation for the register form:
 *  - format check as you type (the form is noValidate, so nothing enforces it)
 *  - debounced availability check against /api/auth/check-email
 *  - blocks submit while the value is invalid or already registered
 * Duplicate accounts are still hard-blocked server-side on submit.
 */
export default function EmailField({
  label,
  id,
  name,
  placeholder,
  autoComplete,
  icon,
}: EmailFieldProps) {
  const tx = useText();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidRef = useRef(false);

  // Block the form submit (capture phase, before React's own handler) while
  // the email is taken or malformed. If this ever misfires, the server's 409
  // still rejects the duplicate — defense in depth.
  useEffect(() => {
    const form = inputRef.current?.closest("form");
    if (!form) return;

    const onCaptureSubmit = (e: Event) => {
      const ev = e as SubmitEvent;
      if (invalidRef.current) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    form.addEventListener("submit", onCaptureSubmit, true);
    return () => form.removeEventListener("submit", onCaptureSubmit, true);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  function handleChange(raw: string) {
    setValue(raw);
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = raw.trim();
    if (!trimmed) {
      setError(null);
      setChecking(false);
      invalidRef.current = false;
      return;
    }

    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address");
      setChecking(false);
      invalidRef.current = true;
      return;
    }

    setChecking(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(trimmed)}`);
        const json = await res.json().catch(() => null);
        const available = json?.data?.available !== false;
        if (!available) {
          setError("An account with this email already exists.");
          invalidRef.current = true;
        } else {
          setError(null);
          invalidRef.current = false;
        }
      } catch {
        // Network hiccup — let the server enforce uniqueness on submit.
        setError(null);
        invalidRef.current = false;
      } finally {
        setChecking(false);
      }
    }, 450);
  }

  return (
    <Reveal delay={400} animation="fadeInUp" duration={900}>
      <div className={`auth-field${error ? " has-error" : ""}`}>
        <label htmlFor={id}>{tx(label)}</label>
        <div className="auth-input">
          {icon && <span className="auth-input-icon">{icon}</span>}
          <input
            ref={inputRef}
            id={id}
            name={name}
            type="email"
            placeholder={tx(placeholder)}
            autoComplete={autoComplete}
            required
            value={value}
            aria-invalid={error ? true : undefined}
            aria-busy={checking || undefined}
            onChange={(e) => handleChange(e.target.value)}
          />
        </div>
        {error && <p className="auth-msg">{tx(error)}</p>}
      </div>
    </Reveal>
  );
}