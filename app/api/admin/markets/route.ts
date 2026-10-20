import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { listMarkets, createMarket } from "@/lib/services/admin";
import { marketSchema } from "@/lib/validators";
import { auditLog } from "@/lib/services/admin-log";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    await requireAdmin();
    return listMarkets();
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const body = await parseJson(req);

    const parsed = marketSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid market data");
    }

    const asset = await createMarket(parsed.data);
    await auditLog(admin.id, "ADMIN", "MARKET.CREATE", "MarketAsset", asset.id, { symbol: asset.symbol });
    return asset;
  });
}