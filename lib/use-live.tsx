"use client";
import { useText } from "@/lib/i18n/text";


import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";

/** Default refresh cadence for live screens. */
export const LIVE_MS = 15_000;

/* Shared "last successful sync" clock so one badge can report every live
   screen in the tab. Client-side only; starts null so SSR and hydration match. */
type SyncListener = (t: number) => void;
const listeners = new Set<SyncListener>();
let lastSync: number | null = null;

function publishSync() {
  lastSync = Date.now();
  for (const l of listeners) l(lastSync);
}

/** Subscribe to the tab-wide last-sync timestamp. */
export function useLastSync(): number | null {
  const [t, setT] = useState<number | null>(lastSync);
  useEffect(() => {
    const l: SyncListener = (v) => setT(v);
    listeners.add(l);
    setT(lastSync);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return t;
}

/**
 * Loads data and keeps it in sync with the server.
 *
 * Runs `refresh` immediately (unless `immediate` is false), then on an
 * interval, plus whenever the tab regains focus or becomes visible again.
 * Polling pauses while the tab is hidden, requests never overlap, and a failed
 * refresh leaves the last good data on screen instead of blanking the page.
 *
 * @param intervalMs 0 disables the interval but still loads on mount.
 */
export function useLive(
  refresh: () => unknown,
  intervalMs: number = LIVE_MS,
  immediate = true
): number | null {
  const locale = useLocale();
  const latest = useRef(refresh);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const runner = useRef<(() => Promise<void>) | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  // Always call the newest closure without resubscribing the interval.
  useEffect(() => {
    latest.current = refresh;
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled || document.hidden) return;
      if (inFlight.current) { queued.current = true; return; }
      inFlight.current = true;
      try {
        await latest.current();
        if (!cancelled) {
          setSyncedAt(Date.now());
          publishSync();
        }
      } catch {
        /* transient failure: keep showing what we have */
      } finally {
        inFlight.current = false;
        if (queued.current) { queued.current = false; void runner.current?.(); }
      }
    };
    runner.current = run;

    if (immediate) {
      publishSync();
      void run();
    }
    const id = intervalMs > 0 ? setInterval(run, intervalMs) : null;
    const onWake = () => {
      if (!document.hidden) void run();
    };
    if (intervalMs > 0) {
      document.addEventListener("visibilitychange", onWake);
      window.addEventListener("focus", onWake);
    }
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
      if (runner.current === run) runner.current = null;
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [intervalMs, immediate, locale]);

  return syncedAt;
}

/** Pulsing indicator showing how fresh the data on screen is. */
export function LiveBadge({ intervalMs = LIVE_MS, className = "" }: { intervalMs?: number; className?: string }) {
  const tx = useText();
  const syncedAt = useLastSync();
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const secs = syncedAt ? Math.max(0, Math.round((Date.now() - syncedAt) / 1000)) : null;
  const text =
    secs === null
      ? tx("Live")
      : secs < 5
        ? tx("Live · just now")
        : tx("Live · {value0} ago", { value0: secs < 60 ? tx("{value0}s", {value0:secs}) : tx("{value0}m {value1}s", {value0:Math.floor(secs / 60),value1:secs % 60}) });

  return (
    <span className={`qfs-live ${className}`.trim()} title={tx("Auto-refreshes every {value0}s", { value0: Math.round(intervalMs / 1000) })}>
      <i aria-hidden="true" />
      {/* wrapped so narrow topbars can drop the label and keep just the dot */}
      <b>{text}</b>
    </span>
  );
}
