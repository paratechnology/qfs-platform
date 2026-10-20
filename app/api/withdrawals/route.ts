import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { withdrawSchema } from "@/lib/validators";
import { dollarsToCents } from "@/lib/money";
import { createWithdrawal } from "@/lib/services/account";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    const user = await requireUser();
    const items = await prisma.withdrawalRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { items: items.map((row) => ({
      id: row.id, type: "WITHDRAWAL", label: "Withdrawal request",
      amount: formatMoney(row.amountCents), status: row.status,
      method: row.method, note: null, reference: row.reference,
      createdAt: row.createdAt.toISOString(),
    })), nextCursor: null };
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await parseJson(req);

    const parsed = withdrawSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid withdrawal data");
    }

    const result = await createWithdrawal(user.id, {
      amountCents: dollarsToCents(parsed.data.amount),
      method: parsed.data.method,
      details: parsed.data.details,
      reference: parsed.data.reference,
      walletAddress: parsed.data.walletAddress,
    });

    return {
      request: result.request,
      created: result.created,
      status: result.request.status,
    };
  });
}
