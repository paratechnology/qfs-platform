import { NextRequest } from "next/server";
import { handle, assertSameOrigin } from "@/lib/api/helpers";
import { destroySession, clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    await destroySession();
    await clearSessionCookie();
    return { loggedOut: true };
  });
}