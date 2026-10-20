import { handle } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    await requireUser();
    const docs = await prisma.document.findMany({
      where: { isActive: true },
      orderBy: { sort: "asc" },
    });
    return docs;
  });
}