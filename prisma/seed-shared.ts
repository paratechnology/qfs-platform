/* Shared constants for seeding. */

export const TB = "qfs/dev.db";

/** Short human-ish referral code: name-slug + random suffix, e.g. JOHN4X. */
export function generateReferralCode(name: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = Array.from(
    crypto.getRandomValues(new Uint8Array(4))
  )
    .map((b) => alphabet[b % alphabet.length])
    .join("");
  const slug = (name || "QFS").replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase();
  return `${slug || "QFS"}${rand}`.slice(0, 10);
}