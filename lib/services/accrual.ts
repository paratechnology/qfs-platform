import "server-only";

import { prisma } from "../db";
import { accrueEarningsForUser } from "./account";

export type AccrualResult = {
  usersProcessed: number;
  credited: number;
  totalCents: number;
};

/**
 * Materialize matured earnings for every user with an active investment.
 *
 * Shared by `POST /api/cron/accrue` and the Netlify scheduled function so both
 * entry points run identical logic — the scheduler cannot send the
 * `x-cron-secret` header, so it calls this directly instead of over HTTP.
 */
export async function runAccrualSweep(): Promise<AccrualResult> {
  const users = await prisma.investment.findMany({
    where: { status: "ACTIVE" },
    select: { userId: true },
    distinct: ["userId"],
  });

  let credited = 0;
  let totalCents = 0;
  for (const { userId } of users) {
    const r = await accrueEarningsForUser(userId);
    credited += r.credited;
    totalCents += r.totalCents;
  }

  return { usersProcessed: users.length, credited, totalCents };
}
