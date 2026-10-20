import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { updateReview, deleteReview } from "@/lib/services/admin";
import { reviewSchema } from "@/lib/validators";
import { auditLog } from "@/lib/services/admin-log";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await parseJson(req);

    const parsed = reviewSchema.partial().safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid review data");
    }
    const review = await updateReview(id, parsed.data as Record<string, unknown>);
    await auditLog(admin.id, "ADMIN", "REVIEW.UPDATE", "Review", id, { status: review.status });
    return review;
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    await deleteReview(id);
    await auditLog(admin.id, "ADMIN", "REVIEW.DELETE", "Review", id);
    return { deleted: true };
  });
}