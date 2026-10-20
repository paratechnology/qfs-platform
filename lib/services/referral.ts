import "server-only";

import { randomBytes } from "crypto";
import { prisma } from "../db";
import { ApiError } from "../api/errors";
import { referralLink } from "../site";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short human-ish referral code: name-slug + random suffix, e.g. JOHN4X. */
export function makeReferralCode(name: string): string {
  const rand = Array.from(randomBytes(4))
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join("");
  const slug = (name || "QFS").replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase();
  return `${slug || "QFS"}${rand}`.slice(0, 10);
}

export async function uniqueReferralCode(name: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = makeReferralCode(name);
    const clash = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!clash) return code;
  }
  throw ApiError.conflict("Could not generate a unique referral code. Try a different name.");
}

/** Public referral URL for a user's code. */
export function referralUrl(code: string): string {
  return referralLink(code);
}
