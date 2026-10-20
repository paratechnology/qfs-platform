import { NextRequest } from "next/server";
import { handle, assertSameOrigin, rateLimitByIp } from "@/lib/api/helpers";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const querySchema = z.object({
  email: z
    .string()
    .email("Enter a valid email address")
    .max(200)
    .trim()
    .toLowerCase(),
});

/**
 * Public availability check used by the register form's email validator.
 * Duplicate accounts are still hard-blocked on submit (registerUser + the
 * unique constraint on User.email); this endpoint only powers the inline UX.
 */
export function GET(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    rateLimitByIp("check-email", req, 30, 60_000);

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({ email: url.searchParams.get("email") ?? "" });
    if (!parsed.success) {
      // Malformed input has nothing to compare against — treat as available.
      return { available: true };
    }

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    return { available: existing === null };
  });
}