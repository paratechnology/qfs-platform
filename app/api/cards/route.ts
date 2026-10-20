import { handle } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    const user = await requireUser();
    const cards = await prisma.card.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return cards;
  });
}