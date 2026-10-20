import { NextRequest } from "next/server";
import { handle } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getLiveQuotes } from "@/lib/live-prices";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const type = new URL(req.url).searchParams.get("type")?.toUpperCase();
    const assets = await prisma.marketAsset.findMany({
      where: { isActive: true, ...(type ? { type: type as any } : {}) },
      orderBy: [{ type: "asc" }, { sort: "asc" }],
    });
    // Overlay live quotes (cached 60s) so the feed stays current; DB price/change
    // remain the fallback when the upstream is unreachable.
    const live = await getLiveQuotes();
    return assets.map((a) => {
      const q = live.get(a.symbol);
      return q
        ? { ...a, price: q.price, change: q.chg, direction: q.up ? ("up" as const) : ("down" as const) }
        : a;
    });
  });
}