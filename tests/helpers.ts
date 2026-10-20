import { prisma } from "../lib/db";
import { registerUser } from "../lib/services/auth";

/** Wipe all rows (dependency-safe order). Leaves schema intact. */
export async function resetDb() {
  await prisma.referralEarning.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.depositRequest.deleteMany();
  await prisma.withdrawalRequest.deleteMany();
  await prisma.investment.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.card.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.walletNonce.deleteMany();
  await prisma.walletConnection.deleteMany();
  await prisma.user.deleteMany();
  await prisma.investmentPlan.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.marketAsset.deleteMany();
  await prisma.document.deleteMany();
  await prisma.review.deleteMany();
}

export type TestUser = {
  id: string;
  name: string;
  email: string;
  referralCode: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
};

/** Create a user (via the real register service so referral codes are unique). */
export async function createUser(name: string, email: string, opts: { referredBy?: string } = {}) {
  const [first, ...rest] = name.split(" ");
  const user = await registerUser({
    firstName: first ?? name,
    lastName: rest.join(" ") || first || name,
    email,
    password: "Test12345!",
    country: "Ghana",
    phone: "+233 20 000 0000",
  });
  if (opts.referredBy) {
    await prisma.user.update({ where: { id: user.id }, data: { referredById: opts.referredBy } });
  }
  return user as unknown as TestUser;
}

/** Create a user directly (bypasses hashing — faster, for non-auth tests). */
export async function createUserDirect(
  name: string,
  opts: { referredById?: string; balanceCents?: number; availableCents?: number } = {}
) {
  const user = await prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replace(/[^a-z]/g, "")}${Math.random().toString(36).slice(2, 8)}@test.qfs`,
      passwordHash: "not-used",
      referralCode: `T${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      country: "United States",
      avatarUrl: "/avatars/avatar1.jpg",
      referredById: opts.referredById,
    },
  });
  await prisma.account.create({
    data: { userId: user.id, balanceCents: opts.balanceCents ?? 0, availableCents: opts.availableCents ?? 0 },
  });
  return user;
}

export async function createPlan(over: { name: string; minAmountCents: number; monthlyRoiBps: number; termMonths: number; maxAmountCents?: number }) {
  return prisma.investmentPlan.create({
    data: {
      name: over.name,
      description: "test plan",
      minAmountCents: over.minAmountCents,
      maxAmountCents: over.maxAmountCents,
      monthlyRoiBps: over.monthlyRoiBps,
      termMonths: over.termMonths,
      isActive: true,
      sort: 1,
      color: "#992c92",
    },
  });
}

/** Set a user's available balance directly (bypasses ledger integrity for setup only). */
export async function fundUser(userId: string, cents: number) {
  return prisma.account.update({ where: { userId }, data: { balanceCents: cents, availableCents: cents } });
}

/** Set a user's referral-rate setting (default 500 bps if unset). */
export async function ensureSetting(key: string, value: string) {
  return prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}