import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { walletChallengeSchema } from "@/lib/validators";
import { issueChallenge } from "@/lib/services/wallet";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * Issues the sign-in challenge. The returned message is the exact text the
 * wallet must sign; it is stored server-side and re-checked on verify.
 */
export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await parseJson(req);

    const parsed = walletChallengeSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid address");
    }

    const challenge = await issueChallenge(user.id, parsed.data.address);
    return { ...challenge, chainIds: [1] };
  });
}
