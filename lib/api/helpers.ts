import { NextResponse, type NextRequest } from "next/server";
import { logger } from "../logger";
import { ApiError } from "./errors";

/* ---------- Response envelope ---------- */

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(
    { ok: true, data },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function handle(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { ok: false, error: { code: err.code, message: err.message } },
        { status: err.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    logger.error("unhandled api error", err);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

/* ---------- Request parsing ---------- */

const MAX_BODY_BYTES = 64 * 1024;

export async function parseJson(req: NextRequest): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    throw ApiError.badRequest("Invalid JSON body");
  }
}

export function clientIp(req: NextRequest): string {
  // x-real-ip is written by the proxy itself; X-Forwarded-For is client-spoofable,
  // so it is only a fallback.
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "unknown";
}

/* ---------- CSRF / same-origin ---------- */

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Blocks cross-site state-changing requests. Modern browsers always send
 * Origin on writes; Referer and Sec-Fetch-Site cover the rest. Requests with
 * none of the three (curl, server-to-server cron) are allowed through.
 */
export function assertSameOrigin(req: NextRequest): void {
  const host = req.headers.get("host") ?? "";

  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== "null" && hostOf(origin) !== host) {
      throw new ApiError(403, "CSRF", "Cross-origin request blocked");
    }
    return;
  }

  const referer = req.headers.get("referer");
  if (referer) {
    if (hostOf(referer) !== host) {
      throw new ApiError(403, "CSRF", "Cross-origin request blocked");
    }
    return;
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError(403, "CSRF", "Cross-origin request blocked");
  }
}

/* ---------- Simple in-memory rate limiting (fixed window per key) ---------- */

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();

  // Bound memory: drop expired buckets once the map grows (attacker-controlled keys).
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
  }

  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (b.count >= limit) throw ApiError.tooMany();
  b.count += 1;
}

/**
 * Per-client rate limit for a request.
 *
 * Client IPs come from proxy headers, so when nothing supplies them every
 * caller lands in the shared "unknown" bucket. That bucket gets a much higher
 * cap — otherwise one noisy client could lock out the entire site.
 */
export function rateLimitByIp(kind: string, req: NextRequest, limit: number, windowMs: number): void {
  const ip = clientIp(req);
  rateLimit(`${kind}:${ip}`, ip === "unknown" ? Math.max(limit * 5, 50) : limit, windowMs);
}

/* ---------- Pagination ---------- */

export function getPagination(req: NextRequest, defaults = { limit: 20 }) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? defaults.limit) || defaults.limit, 1), 100);
  const cursor = url.searchParams.get("cursor") ?? null;
  const page = Math.max(Number(url.searchParams.get("page") ?? 1) || 1, 1);
  return { limit, cursor, page };
}

export function cursorResponse(items: unknown[], nextCursor: string | null) {
  return { items, nextCursor };
}

export function pageResponse(items: unknown[], total: number, page: number, limit: number) {
  return { items, total, page, limit, totalPages: Math.max(Math.ceil(total / limit), 1) };
}