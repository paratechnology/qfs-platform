import "@/styles/dashboard.css";
import DashboardApp from "@/components/dashboard/DashboardApp";
import { redirect } from "next/navigation";
import { DEV_USER_ID, getSessionUser } from "@/lib/session";
import { laravelUrl } from "@/lib/backend";
import { getDevOverview } from "@/lib/dev-overview";
import { cookies } from "next/headers";
import type { OverviewData } from "@/lib/api-types";
import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/user/user/login");
  if (user.id === DEV_USER_ID) return <><DashboardApp overview={getDevOverview()} demo />{children}</>;

  const token = (await cookies()).get("qfs_session")?.value ?? "";
  const response = await fetch(laravelUrl("/api/dashboard/overview"), {
    headers: { Cookie: `qfs_session=${encodeURIComponent(token)}`, "Accept-Language": await getLocale() }, cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error?.message ?? "Dashboard unavailable");
  const overview = body.data as OverviewData;
  return <><DashboardApp overview={overview} />{children}</>;
}
