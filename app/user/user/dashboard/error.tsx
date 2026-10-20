"use client";
import { SUPPORT_HREF } from "@/lib/site";

import { useText } from "@/lib/i18n/text";


export default function AccountError({ reset }: { reset: () => void }) {
  const tx = useText();
  return <div className="qfs-dash"><main className="dash-body">
    <h1>{tx("Account unavailable")}</h1>
    <p>{tx("We couldn’t load your account. Please try again.")}</p>
    <button className="dash-btn primary" onClick={reset}>{tx("Try again")}</button>
    <a className="dash-btn ghost" href={SUPPORT_HREF}>{tx("Contact support for more information")}</a>
  </main></div>;
}
