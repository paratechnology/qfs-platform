import { handle } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    await requireUser();
    const reviews = await prisma.review.findMany({
      where: { status: "APPROVED" },
      orderBy: { sort: "asc" },
      take: 30,
    });
    return reviews;
  });
}