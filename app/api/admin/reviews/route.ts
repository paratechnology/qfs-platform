import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { listReviews, createReview } from "@/lib/services/admin";
import { reviewSchema } from "@/lib/validators";
import { auditLog } from "@/lib/services/admin-log";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    await requireAdmin();
    return listReviews();
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const body = await parseJson(req);

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid review data");
    }

    const review = await createReview(parsed.data);
    await auditLog(admin.id, "ADMIN", "REVIEW.CREATE", "Review", review.id, { user: review.userName });
    return review;
  });
}