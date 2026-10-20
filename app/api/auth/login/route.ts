import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin, rateLimit, rateLimitByIp } from "@/lib/api/helpers";
import { loginSchema } from "@/lib/validators";
import { loginUser } from "@/lib/services/auth";
import { createDevSession, createSession, devLoginEnabled, isDevLogin, setSessionCookie } from "@/lib/session";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    rateLimitByIp("login", req, 15, 60_000);
    const body = await parseJson(req);

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid login data");
    }

    if (devLoginEnabled() && parsed.data.email === process.env.QFS_DEV_LOGIN_EMAIL!.trim().toLowerCase()) {
      if (!isDevLogin(parsed.data.email, parsed.data.password)) {
        throw ApiError.unauthorized("Invalid email or password");
      }
      await setSessionCookie(createDevSession());
      return {
        user: {
          id: "qfs-local-dev-preview",
          name: "Local Demo",
          email: parsed.data.email,
          role: "USER",
          referralCode: "DEMO",
        },
      };
    }

    // Per-account throttle: client IP is spoofable via headers, the email is not.
    rateLimit(`login:acct:${parsed.data.email}`, 10, 60_000);

    const user = await loginUser(parsed.data);
    const token = await createSession(user.id);
    await setSessionCookie(token);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        referralCode: user.referralCode,
      },
    };
  });
}
