import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { adjustmentSchema } from "@/lib/validators";
import { dollarsToCents } from "@/lib/money";
import { adjustUserBalance, adjustAllUsers } from "@/lib/services/account";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

/* Admin profit manipulation: credit or debit one user, or every non-admin
   user at once. Signed amount lands as a completed ADJUSTMENT transaction. */
export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const body = await parseJson(req);

    const parsed = adjustmentSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid adjustment");
    }

    const cents = dollarsToCents(parsed.data.amount);
    const amountCents = parsed.data.direction === "DEBIT" ? -cents : cents;

    if (parsed.data.scope === "ALL") {
      const summary = await adjustAllUsers(admin.id, amountCents, parsed.data.note);
      return { scope: "ALL", ...summary };
    }

    if (!parsed.data.userId) {
      throw ApiError.badRequest("Select a user for a single adjustment");
    }
    const result = await adjustUserBalance(admin.id, parsed.data.userId, amountCents, parsed.data.note);
    return {
      scope: "USER",
      applied: result.applied,
      direction: result.debit ? "DEBIT" : "CREDIT",
      amountCents: result.abs,
      balanceCents: result.newBalance,
      availableCents: result.newAvailable,
    };
  });
}