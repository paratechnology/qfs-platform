import { NextRequest } from "next/server";
import { handle, parseJson, assertSameOrigin } from "@/lib/api/helpers";
import { requireAdmin } from "@/lib/session";
import { updatePlan, deletePlan } from "@/lib/services/admin";
import { planSchema } from "@/lib/validators";
import { dollarsToCents } from "@/lib/money";
import { auditLog } from "@/lib/services/admin-log";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await parseJson(req);

    const parsed = planSchema.partial().safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid plan data");
    }
    const d = parsed.data;
    const plan = await updatePlan(id, {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.minAmount !== undefined ? { minAmountCents: dollarsToCents(d.minAmount) } : {}),
      ...(d.maxAmount !== undefined ? { maxAmountCents: dollarsToCents(d.maxAmount) } : {}),
      ...(d.monthlyRoiPct !== undefined ? { monthlyRoiBps: Math.round(d.monthlyRoiPct * 100) } : {}),
      ...(d.termMonths !== undefined ? { termMonths: d.termMonths } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.sort !== undefined ? { sort: d.sort } : {}),
      ...(d.color !== undefined ? { color: d.color } : {}),
    });
    await auditLog(admin.id, "ADMIN", "PLAN.UPDATE", "InvestmentPlan", id, { name: plan.name });
    return plan;
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    await deletePlan(id);
    await auditLog(admin.id, "ADMIN", "PLAN.DELETE", "InvestmentPlan", id);
    return { deleted: true };
  });
}