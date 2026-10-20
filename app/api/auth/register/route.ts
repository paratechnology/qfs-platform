import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin, rateLimit, rateLimitByIp } from "@/lib/api/helpers";
import { registerSchema } from "@/lib/validators";
import { registerUser } from "@/lib/services/auth";
import { destroySession, clearSessionCookie } from "@/lib/session";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    rateLimitByIp("register", req, 10, 60_000);
    const body = await parseJson(req);

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid registration data");
    }

    // Per-address cap, so one email can't be hammered from rotating IPs.
    rateLimit(`register:acct:${parsed.data.email}`, 3, 10 * 60_000);

    const user = await registerUser(parsed.data);
    await destroySession();
    await clearSessionCookie();

    return {
      registered: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        referralCode: user.referralCode,
      },
    };
  });
}
