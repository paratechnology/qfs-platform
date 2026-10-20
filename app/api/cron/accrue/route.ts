import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { handle } from "@/lib/api/helpers";
import { runAccrualSweep } from "@/lib/services/accrual";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

/** Constant-time string compare so the secret can't be guessed byte by byte. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Secret-keyed accrual trigger. Call with header `x-cron-secret` matching
 * CRON_SECRET to materialize matured earnings for every active investment.
 * The endpoint is disabled when CRON_SECRET is not configured.
 *
 * On Netlify the same sweep runs on a schedule via `netlify/functions/accrue.mts`,
 * which calls the shared service directly — the scheduler cannot set headers.
 */
export function POST(req: NextRequest) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      throw new ApiError(503, "DISABLED", "CRON_SECRET is not configured");
    }

    const provided = req.headers.get("x-cron-secret") ?? "";
    if (!secretMatches(provided, secret)) {
      throw ApiError.forbidden("Invalid cron secret");
    }

    const result = await runAccrualSweep();
    return { accrued: result.credited, totalCents: result.totalCents, usersProcessed: result.usersProcessed };
  });
}