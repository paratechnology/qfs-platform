import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { updateMarket, deleteMarket } from "@/lib/services/admin";
import { marketSchema } from "@/lib/validators";
import { auditLog } from "@/lib/services/admin-log";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await parseJson(req);

    const parsed = marketSchema.partial().safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid market data");
    }
    const asset = await updateMarket(id, parsed.data as Record<string, unknown>);
    await auditLog(admin.id, "ADMIN", "MARKET.UPDATE", "MarketAsset", id, { symbol: asset.symbol });
    return asset;
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    await deleteMarket(id);
    await auditLog(admin.id, "ADMIN", "MARKET.DELETE", "MarketAsset", id);
    return { deleted: true };
  });
}