import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin, ok } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { loanSchema } from "@/lib/validators";
import { dollarsToCents } from "@/lib/money";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    const user = await requireUser();
    const loans = await prisma.loan.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return loans;
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await parseJson(req);

    const parsed = loanSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid loan data");
    }

    // Guard: only one pending loan per user at a time.
    const pending = await prisma.loan.count({ where: { userId: user.id, status: "PENDING" } });
    if (pending > 0) {
      throw ApiError.conflict("You already have a loan application under review.");
    }

    const loan = await prisma.loan.create({
      data: {
        userId: user.id,
        type: parsed.data.type,
        currency: parsed.data.currency,
        amountCents: dollarsToCents(parsed.data.amount),
        period: Number(parsed.data.period) || 12,
        occupation: parsed.data.occupation || null,
      },
    });

    return loan;
  });
}