"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AVAILABLE_LANGUAGES } from "@/lib/i18n/locales";
import { setLanguage } from "@/lib/i18n/actions";
import { useText } from "@/lib/i18n/text";

export default function LanguageSelector() {
  const tx = useText();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const locked = useRef(false);
  return <div className="language-control">
    <label className="language-selector" aria-busy={pending}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18" /></svg>
      <span className="language-sr-only">{tx("Language")}</span>
      <select value={locale} disabled={pending} onChange={(event) => {
        if (locked.current) return;
        const selected = event.target.value;
        locked.current = true; setError(false);
        startTransition(async () => {
          try { await setLanguage(selected); router.refresh(); }
          catch { setError(true); }
          finally { locked.current = false; }
        });
      }}>
        {AVAILABLE_LANGUAGES.map((language) => <option key={language.code} value={language.code} lang={language.code}>{language.name}</option>)}
      </select>
      {pending && <span className="language-spinner" aria-hidden="true" />}
    </label>
    <span className="language-sr-only" role="status">{pending ? tx("Changing language…") : ""}</span>
    {error && <span className="language-error" role="alert">{tx("Could not change language. Please try again.")}</span>}
  </div>;
}
