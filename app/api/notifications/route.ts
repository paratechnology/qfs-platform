import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    const user = await requireUser();
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
      items: items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        link: n.link,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
      unread,
    };
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await parseJson(req);
    const id = typeof body.id === "string" ? body.id : null;

    if (id) {
      const n = await prisma.notification.findFirst({ where: { id, userId: user.id } });
      if (!n) throw ApiError.notFound("Notification not found");
      await prisma.notification.update({
        where: { id },
        data: { readAt: n.readAt ?? new Date() },
      });
    } else {
      // Mark all as read.
      await prisma.notification.updateMany({
        where: { userId: user.id, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return { read: true };
  });
}