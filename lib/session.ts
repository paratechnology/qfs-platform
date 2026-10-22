import "server-only";
import { cookies } from "next/headers";
import { laravelUrl } from "./backend";

export const SESSION_COOKIE = "qfs_session";
export const DEV_USER_ID = "qfs-local-dev-preview";

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

/** Laravel validates sessions, including the optional local read-only preview. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const response = await fetch(laravelUrl("/api/auth/me"), {
    headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Account service is temporarily unavailable.");
  const body = await response.json();
  if (!body.ok || !body.data) throw new Error("Account service returned an invalid response.");
  return { ...body.data, memberSince: new Date(body.data.memberSince) } as SessionUser;
}
