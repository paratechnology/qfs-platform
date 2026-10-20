import "server-only";

/* Live market quotes from Yahoo Finance's public chart endpoint — no API key.
   Equities are exchange-quoted (the free feed is typically ~15 min delayed for
   stocks; crypto and the metal futures are near-live). Quotes decorate the
   seeded MarketAsset rows at display time only: the DB `price`/`change`
   columns stay as the last-known fallback when the upstream is unreachable,
   and admin market editing is unaffected.

   One batch refresh per server process every TTL_MS, single-flight — every
   dashboard poll shares the same refresh window instead of hammering Yahoo. */

const TICKER: Record<string, string> = {
  // metals — COMEX/NYMEX futures
  XAU: "GC=F",
  XAG: "SI=F",
  XPT: "PL=F",
  XPD: "PA=F",
  XCU: "HG=F",
  // indices
  SPX: "^GSPC",
  IXIC: "^IXIC",
  DJI: "^DJI",
  // equities
  AAPL: "AAPL",
  TSLA: "TSLA",
  NVDA: "NVDA",
  MSFT: "MSFT",
  AMZN: "AMZN",
  // crypto
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  XRP: "XRP-USD",
  SOL: "SOL-USD",
  DOGE: "DOGE-USD",
  ADA: "ADA-USD",
  LTC: "LTC-USD",
  BNB: "BNB-USD",
};

export type LiveQuote = { price: string; chg: string; up: boolean };

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
};

const TTL_MS = 60_000;
/* A single symbol may take up to TIMEOUT_MS, but the whole refresh must never
   outlive BUDGET_MS — otherwise one slow Yahoo batch stalls every dashboard
   overview for half a minute. Remaining budget shrinks each timeout. */
const TIMEOUT_MS = 5_000;
const BUDGET_MS = 6_000;
const CONCURRENCY = 6;

type CacheEntry = { at: number; values: Map<string, LiveQuote> };
let cache: CacheEntry | Promise<Map<string, LiveQuote>> | null = null;

/* Match the seeded display style: 2dp for big prices, more precision lower down. */
function fmtPrice(n: number): string {
  const abs = Math.abs(n);
  const minFrac = abs >= 100 ? 2 : 0;
  const maxFrac = abs >= 100 ? 2 : abs >= 1 ? 4 : 5;
  return n.toLocaleString("en-US", { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
}

function fmtChg(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

async function fetchQuote(ticker: string, timeoutMs: number): Promise<{ price: number; pct: number }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const meta = (await res.json())?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!Number.isFinite(price)) throw new Error(`Yahoo ${ticker}: no price in response`);
  const pct = Number(meta?.regularMarketChangePercent);
  const prevClose = Number(meta?.chartPreviousClose);
  const changePct =
    Number.isFinite(pct)
      ? pct
      : Number.isFinite(prevClose) && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : 0;
  return { price, pct: changePct };
}

async function refresh(): Promise<Map<string, LiveQuote>> {
  const symbols = Object.keys(TICKER);
  const values = new Map<string, LiveQuote>();
  const started = Date.now();
  // Fetch in small batches so any upstream throttling hits a few symbols at a
  // time; a failed symbol simply keeps its DB price for this cycle. The budget
  // shrinks each batch's timeout so the whole refresh can never stall long
  // enough to delay a dashboard overview.
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const remaining = BUDGET_MS - (Date.now() - started);
    if (remaining <= 0) break;
    const batch = symbols.slice(i, i + CONCURRENCY);
    const timeout = Math.min(TIMEOUT_MS, Math.max(250, remaining));
    await Promise.all(
      batch.map(async (sym) => {
        try {
          const { price, pct } = await fetchQuote(TICKER[sym], timeout);
          values.set(sym, { price: fmtPrice(price), chg: fmtChg(pct), up: pct >= 0 });
        } catch {
          /* upstream blip — fall back to the seeded price */
        }
      })
    );
  }
  return values;
}

/** Latest quotes for every tracked symbol, cached + single-flight. Never
 *  rejects: an empty map means "use the DB values". */
export async function getLiveQuotes(): Promise<Map<string, LiveQuote>> {
  const now = Date.now();
  if (cache instanceof Promise) return cache;
  if (cache && now - cache.at < TTL_MS) return cache.values;
  cache = refresh();
  const values = await cache;
  cache = { at: now, values };
  return values;
}