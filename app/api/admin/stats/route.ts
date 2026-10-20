import { handle } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { getAdminStats } from "@/lib/services/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    await requireAdmin();
    return getAdminStats();
  });
}