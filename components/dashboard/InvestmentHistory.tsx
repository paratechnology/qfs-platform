"use client";
import { useText } from "@/lib/i18n/text";


import { useEffect, useState } from "react";
import type { InvestmentItem } from "@/lib/api-types";
import { LIVE_MS } from "@/lib/use-live";
import InvestmentPortfolio from "./InvestmentPortfolio";
import { ListSkeleton, LoadError } from "./feedback";

type Page = { items: InvestmentItem[]; nextCursor: string | null };

export default function InvestmentHistory({ demo = false }: { demo?: boolean }) {
  const tx = useText();
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Array<string | null>>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (demo) { setLoading(false); return; }
    const controller = new AbortController();
    let inFlight = false;
    setLoading(true); setPage(null); setError("");
    async function load() {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/investments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: controller.signal });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error?.message ?? "Could not load completed investments.");
        if (!controller.signal.aborted) { setPage(json.data); setError(""); }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), LIVE_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [cursor, retry, demo, tx.locale]);

  return <section className="dash-investment-history" aria-label={tx("Completed investments")}>
    <div className="dash-section-title"><h2>{tx("Completed investments")}</h2></div>
    {loading && !page ? <ListSkeleton label={tx("Loading completed investments")} /> : <>
      {error && <LoadError message={error} retry={() => setRetry((value) => value + 1)} />}
      {page?.items.length ? <InvestmentPortfolio items={page.items} /> : !error && <p className="dash-investment-empty">{tx("Completed terms and principal returns will appear here.")}</p>}
      {(previous.length > 0 || page?.nextCursor) && <div className="dash-actions-row">
        <button className="dash-btn ghost" disabled={!previous.length || loading} onClick={() => { setCursor(previous[previous.length - 1]); setPrevious(previous.slice(0, -1)); }}>{tx("Previous")}</button>
        <button className="dash-btn ghost" disabled={!page?.nextCursor || loading} onClick={() => { setPrevious([...previous, cursor]); setCursor(page!.nextCursor); }}>{tx("Next")}</button>
      </div>}
    </>}
  </section>;
}
