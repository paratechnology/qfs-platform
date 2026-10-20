import "server-only";

import { compare, hash } from "bcryptjs";
import { prisma } from "../db";
import { ApiError } from "../api/errors";
import { uniqueReferralCode } from "./referral";

export type RegisterInput = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  country?: string;
  phone?: string;
  referralCode?: string;
};

/* bcrypt cost — deliberately expensive to slow offline cracking. */
const BCRYPT_ROUNDS = 12;
/* bcrypt silently ignores input past 72 bytes, so reject longer passwords. */
const BCRYPT_MAX_BYTES = 72;
/* Compared against when the email is unknown, so a missing account costs the
   same time as a wrong password (no user enumeration by response timing). */
const DUMMY_HASH = "$2b$12$6qnBXsNWMbuc2xr.d8Be.ue6wgcQ4isW0r3k2pa1NKcDc8GYuvtq2";

function assertHashablePassword(password: string): void {
  if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_BYTES) {
    throw ApiError.badRequest("Password is too long (72 bytes maximum)");
  }
}

export async function registerUser(input: RegisterInput) {
  assertHashablePassword(input.password);

  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw ApiError.conflict("An account with this email already exists.");
  }

  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.replace(/\s+/g, " ");
  const referralCode = await uniqueReferralCode(fullName);
  const passwordHash = await hash(input.password, BCRYPT_ROUNDS);
  const referrer = input.referralCode
    ? await prisma.user.findUnique({ where: { referralCode: input.referralCode.trim().toUpperCase() } })
    : null;

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email,
        passwordHash,
        name: fullName,
        phone: input.phone?.trim() || null,
        country: input.country?.trim() || "United States",
        referralCode,
        referredById: referrer?.id ?? null,
        avatarUrl: "/avatars/avatar1.jpg",
      },
    });
    await tx.account.create({ data: { userId: u.id } });
    return u;
  });

  return user;
}

export type LoginInput = { email: string; password: string };

export async function loginUser(input: LoginInput) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  const match = await compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !match) throw ApiError.unauthorized("Invalid email or password");

  if (user.status === "SUSPENDED") {
    throw new ApiError(403, "SUSPENDED", "This account has been suspended. Contact support.");
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}
