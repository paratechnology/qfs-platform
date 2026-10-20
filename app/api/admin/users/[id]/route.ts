import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { updateUser } from "@/lib/services/admin";
import { userActionSchema } from "@/lib/validators";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await parseJson(req);

    const parsed = userActionSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid action");
    }

    const target = await updateUser(admin.id, id, parsed.data.action, parsed.data.role);
    return {
      id: target?.id,
      status: target?.status,
      role: target?.role,
    };
  });
}