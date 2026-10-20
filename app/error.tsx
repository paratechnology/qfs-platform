"use client";
import { SUPPORT_HREF } from "@/lib/site";

import { useText } from "@/lib/i18n/text";
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tx = useText();
  return <main className="action-error-page"><h1>{tx("Unable to load this page")}</h1><p>{tx("Please try again. If the problem continues, contact support.")}</p><button type="button" onClick={reset}>{tx("Try again")}</button><a href={SUPPORT_HREF}>{tx("Contact support for more information")}</a></main>;
}
