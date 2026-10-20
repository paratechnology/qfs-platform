import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { walletVerifySchema } from "@/lib/validators";
import { verifyAndConnect } from "@/lib/services/wallet";
import { auditLog } from "@/lib/services/admin-log";
import { clientIp } from "@/lib/api/helpers";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * Verifies a wallet signature and stores the connection.
 *
 * The address is only saved if the signature recovers to that same address, so a
 * user cannot attach a wallet they do not control. This never moves money — it
 * only proves ownership.
 */
export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await parseJson(req);

    const parsed = walletVerifySchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid wallet proof");
    }

    const result = await verifyAndConnect(user.id, parsed.data);

    await auditLog(user.id, user.role, "WALLET_CONNECT", "Wallet", result.address, {
      chainId: result.chainId,
      alreadyConnected: result.alreadyConnected,
    }, clientIp(req));

    return result;
  });
}
