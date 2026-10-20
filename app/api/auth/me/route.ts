import { handle } from "@/lib/api/helpers";
import { getSessionUser } from "@/lib/session";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    const user = await getSessionUser();
    if (!user) throw ApiError.unauthorized();
    return user;
  });
}