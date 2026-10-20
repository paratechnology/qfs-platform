/* One-off pre-launch cleanup: remove ALL demo/test users (and their cascaded
   data) plus the demo reviews, keeping only the admin account and reference
   content (plans, markets, documents, settings).
   Run with: npx tsx prisma/cleanup-demo.ts */

import { prisma } from "../lib/db";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@qfs.local";

(async () => {
  const admins = await prisma.user.findMany({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  const keepIds = new Set(admins.map((a) => a.id));

  if (admins.length === 0) {
    console.log(`WARNING: admin account "${ADMIN_EMAIL}" not found — nothing kept. Aborting.`);
    return;
  }

  const demoUsers = await prisma.user.findMany({ select: { id: true } });
  const demoIds = demoUsers.filter((u) => !keepIds.has(u.id)).map((u) => u.id);

  if (demoIds.length === 0) {
    console.log("No demo users found — database is already clean.");
  } else {
    // ReferralEarning.investmentId has no cascade, so clear referral rows before
    // deleting users (user deletion cascades their investments). Everything else
    // (accounts, ledger entries, transactions, sessions, cards, requests, loans,
    // notifications, wallets, audit logs) cascades from the user rows.
    const demoInvestments = await prisma.investment.findMany({
      where: { userId: { in: demoIds } },
      select: { id: true },
    });
    const demoInvestmentIds = demoInvestments.map((i) => i.id);
    const re = await prisma.referralEarning.deleteMany({
      where: {
        OR: [
          { referrerId: { in: demoIds } },
          { referredUserId: { in: demoIds } },
          { investmentId: { in: demoInvestmentIds } },
        ],
      },
    });

    const deleted = await prisma.user.deleteMany({ where: { id: { in: demoIds } } });
    console.log(`Deleted ${re.count} referral earnings, ${deleted.count} demo users.`);
  }

  const reviews = await prisma.review.deleteMany({});
  console.log(`Deleted ${reviews.count} demo review(s).`);

  const keep = await prisma.user.count();
  console.log(`Remaining users: ${keep} (${ADMIN_EMAIL})`);
  for (const [table, count] of [
    ["transactions", await prisma.transaction.count()],
    ["accounts", await prisma.account.count()],
    ["sessions", await prisma.session.count()],
    ["reviews", await prisma.review.count()],
    ["plans", await prisma.investmentPlan.count()],
    ["markets", await prisma.marketAsset.count()],
    ["documents", await prisma.document.count()],
    ["settings", await prisma.setting.count()],
  ] as Array<[string, number]>) {
    console.log(`  ${table}: ${count}`);
  }
})().finally(() => prisma.$disconnect());