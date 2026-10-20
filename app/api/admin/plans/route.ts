import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { listPlans, createPlan } from "@/lib/services/admin";
import { planSchema } from "@/lib/validators";
import { dollarsToCents } from "@/lib/money";
import { auditLog } from "@/lib/services/admin-log";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    await requireAdmin();
    return listPlans();
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const body = await parseJson(req);

    const parsed = planSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid plan data");
    }

    const plan = await createPlan({
      name: parsed.data.name,
      description: parsed.data.description || undefined,
      minAmountCents: dollarsToCents(parsed.data.minAmount),
      maxAmountCents: parsed.data.maxAmount !== undefined ? dollarsToCents(parsed.data.maxAmount) : undefined,
      monthlyRoiBps: Math.round(parsed.data.monthlyRoiPct * 100),
      termMonths: parsed.data.termMonths,
      isActive: parsed.data.isActive,
      sort: parsed.data.sort,
      color: parsed.data.color,
    });
    await auditLog(admin.id, "ADMIN", "PLAN.CREATE", "InvestmentPlan", plan.id, { name: plan.name });
    return plan;
  });
}