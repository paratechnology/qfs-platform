import { NextRequest } from "next/server";
import { handle, getPagination, cursorResponse } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const runtime = "nodejs";

const TYPE_LABEL: Record<string, string> = {
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  INVESTMENT: "Investment",
  EARNING: "Earning",
  REFERRAL_BONUS: "Referral Bonus",
  LOAN: "Loan",
  ADJUSTMENT: "Adjustment",
};

export function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const { limit, cursor } = getPagination(req, { limit: 15 });
    const typeFilter = new URL(req.url).searchParams.get("type");
    const idFilter = new URL(req.url).searchParams.get("id");
    const where = {
      userId: user.id,
      ...(typeFilter ? { type: typeFilter as any } : {}),
      ...(idFilter ? { id: idFilter } : {}),
    };

    const items = await prisma.transaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? pageItems[pageItems.length - 1].id : null;

    return cursorResponse(
      pageItems.map((t) => ({
        id: t.id,
        type: t.type,
        label: TYPE_LABEL[t.type] ?? t.type,
        amount: formatMoney(t.amountCents),
        amountCents: t.amountCents,
        status: t.status,
        method: t.method,
        note: t.note,
        reference: t.reference,
        createdAt: t.createdAt.toISOString(),
      })),
      nextCursor
    );
  });
}
