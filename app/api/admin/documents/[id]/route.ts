import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { updateDocument, deleteDocument } from "@/lib/services/admin";
import { documentSchema } from "@/lib/validators";
import { auditLog } from "@/lib/services/admin-log";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await parseJson(req);

    const parsed = documentSchema.partial().safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid document data");
    }
    const doc = await updateDocument(id, parsed.data as Record<string, unknown>);
    await auditLog(admin.id, "ADMIN", "DOCUMENT.UPDATE", "Document", id, { code: doc.code });
    return doc;
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    await deleteDocument(id);
    await auditLog(admin.id, "ADMIN", "DOCUMENT.DELETE", "Document", id);
    return { deleted: true };
  });
}