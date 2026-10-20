import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { investSchema } from "@/lib/validators";
import { dollarsToCents } from "@/lib/money";
import { createInvestment } from "@/lib/services/account";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await parseJson(req);

    const parsed = investSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid investment data");
    }

    const result = await createInvestment(user.id, {
      planId: parsed.data.planId,
      amountCents: dollarsToCents(parsed.data.amount),
      reference: parsed.data.reference,
    });

    return {
      investment: result.investment,
      created: result.created,
    };
  });
}