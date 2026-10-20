import { handle } from "@/lib/api/helpers";
import { DEV_USER_ID, getSessionUser } from "@/lib/session";
import { getDashboardOverview } from "@/lib/services/overview";
import { getDevOverview } from "@/lib/dev-overview";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const user = await getSessionUser();
    if (!user) throw ApiError.unauthorized();
    if (user.id === DEV_USER_ID) return getDevOverview();
    return getDashboardOverview(user.id);
  });
}
