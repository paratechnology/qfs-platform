import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { ApiError } from "./api/errors";

export const SESSION_COOKIE = "qfs_session";
export const DEV_USER_ID = "qfs-local-dev-preview";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const DEV_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
/* Dev/test only. Production refuses to run without a real secret. */
const DEV_SESSION_SECRET = "qfs-dev-insecure-session-secret";

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to a value of at least 32 characters");
  }
  return DEV_SESSION_SECRET;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  avatarUrl: string;
  country: string;
  referralCode: string;
  memberSince: Date;
  kycLevel: number;
};

export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV === "development" &&
    process.env.QFS_DEV_LOGIN === "true" &&
    Boolean(process.env.QFS_DEV_LOGIN_EMAIL && process.env.QFS_DEV_LOGIN_PASSWORD);
}

export function isDevLogin(email: string, password: string): boolean {
  if (!devLoginEnabled()) return false;
  const expectedEmail = process.env.QFS_DEV_LOGIN_EMAIL!.trim().toLowerCase();
  const expectedPassword = process.env.QFS_DEV_LOGIN_PASSWORD!;
  const actual = Buffer.from(password);
  const expected = Buffer.from(expectedPassword);
  return email.trim().toLowerCase() === expectedEmail &&
    actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createDevSession(): string {
  if (!devLoginEnabled()) throw new Error("Local dev login is disabled");
  const expiresAt = Date.now() + DEV_SESSION_TTL_MS;
  const nonce = randomBytes(16).toString("hex");
  const payload = `dev.${expiresAt}.${nonce}`;
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function devSessionUser(token: string): SessionUser | null {
  if (!devLoginEnabled() || !token.startsWith("dev.")) return null;
  const match = /^dev\.(\d{13})\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(token);
  if (!match || Number(match[1]) < Date.now()) return null;
  const payload = `dev.${match[1]}.${match[2]}`;
  const expected = Buffer.from(createHmac("sha256", sessionSecret()).update(payload).digest("hex"), "hex");
  const actual = Buffer.from(match[3], "hex");
  if (!timingSafeEqual(actual, expected)) return null;
  return {
    id: DEV_USER_ID,
    email: process.env.QFS_DEV_LOGIN_EMAIL!,
    name: "Local Demo",
    role: "USER",
    status: "ACTIVE",
    avatarUrl: "/avatars/avatar1.jpg",
    country: "Local preview",
    referralCode: "DEMO",
    memberSince: new Date(),
    kycLevel: 0,
  };
}

/* Keyed with SESSION_SECRET, so a leaked DB on its own is not enough to
   produce a valid tokenHash. */
function hashToken(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

function toSessionUser(u: {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  avatarUrl: string;
  country: string;
  referralCode: string;
  memberSince: Date;
  kycLevel: number;
}): SessionUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    avatarUrl: u.avatarUrl,
    country: u.country,
    referralCode: u.referralCode,
    memberSince: u.memberSince,
    kycLevel: u.kycLevel,
  };
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

/** Returns the logged-in user or null. Verifies the token against the DB. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  if (token.startsWith("dev.")) return devSessionUser(token);

  // Server components verify Laravel sessions through the same API used by the
  // browser. The legacy Next API handlers retain the compatible Session table.
  if (process.env.LARAVEL_API_URL) {
    const response = await fetch(`${process.env.LARAVEL_API_URL.replace(/\/$/, "")}/api/auth/me`, {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) return null;
    const body = await response.json().catch(() => null);
    const user = body?.data;
    return user ? { ...user, memberSince: new Date(user.memberSince) } as SessionUser : null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // A suspended account has no access at all, even with a live cookie.
  if (session.user.status !== "ACTIVE") {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return toSessionUser(session.user);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw ApiError.unauthorized();
  if (user.id === DEV_USER_ID) {
    throw ApiError.forbidden("Local demo is read-only. Connect PostgreSQL to use account actions.");
  }
  if (user.status === "SUSPENDED") {
    await destroySession();
    throw new ApiError(403, "SUSPENDED", "This account has been suspended. Contact support.");
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw ApiError.forbidden();
  return user;
}

export async function destroySession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token?.startsWith("dev.")) return;
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => {});
  }
}

/** Used by admins to force-logout a user (suspend, etc.). */
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function setSessionCookie(token: string): Promise<void> {
  // Awaiting cookies() and .set() in a Route Handler attaches Set-Cookie to the response.
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}
