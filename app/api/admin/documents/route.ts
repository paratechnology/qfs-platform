import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { listDocuments, createDocument } from "@/lib/services/admin";
import { documentSchema } from "@/lib/validators";
import { auditLog } from "@/lib/services/admin-log";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    await requireAdmin();
    return listDocuments();
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const body = await parseJson(req);

    const parsed = documentSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid document data");
    }

    const doc = await createDocument(parsed.data);
    await auditLog(admin.id, "ADMIN", "DOCUMENT.CREATE", "Document", doc.id, { code: doc.code });
    return doc;
  });
}