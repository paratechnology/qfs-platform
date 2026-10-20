import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { decideLoan } from "@/lib/services/admin";
import { loanDecisionSchema } from "@/lib/validators";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await parseJson(req);

    const parsed = loanDecisionSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid decision");
    }

    const loan = await decideLoan(admin.id, id, parsed.data.action, parsed.data.note);
    return { decided: true, status: loan?.status };
  });
}