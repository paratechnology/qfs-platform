import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { walletDisconnectSchema } from "@/lib/validators";
import { disconnectWallet, listWallets } from "@/lib/services/wallet";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

/** Lists the caller's own verified wallets. */
export function GET() {
  return handle(async () => {
    const user = await requireUser();
    const wallets = await listWallets(user.id);
    return {
      wallets: wallets.map((w) => ({
        address: w.address,
        chainId: w.chainId,
        label: w.label,
        lastUsedAt: w.lastUsedAt,
      })),
    };
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await parseJson(req);

    const parsed = walletDisconnectSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid address");
    }

    await disconnectWallet(user.id, parsed.data.address);
    return { disconnected: true, address: parsed.data.address };
  });
}
