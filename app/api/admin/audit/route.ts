import { NextRequest } from "next/server";
import { handle } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { listAudit } from "@/lib/services/admin";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return handle(async () => {
    await requireAdmin();
    const url = new URL(req.url);
    return listAudit({
      page: Number(url.searchParams.get("page") ?? 1),
      limit: Number(url.searchParams.get("limit") ?? 50),
    });
  });
}