import { handle } from "@/lib/api/helpers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { referralUrl } from "@/lib/services/referral";

export const runtime = "nodejs";

export function GET() {
  return handle(async () => {
    const user = await requireUser();
    const [referredCount, earningsAgg] = await Promise.all([
      prisma.user.count({ where: { referredById: user.id } }),
      prisma.referralEarning.aggregate({ where: { referrerId: user.id }, _sum: { amountCents: true } }),
    ]);
    return {
      code: user.referralCode,
      url: referralUrl(user.referralCode),
      count: referredCount,
      earningsCents: earningsAgg._sum.amountCents ?? 0,
    };
  });
}