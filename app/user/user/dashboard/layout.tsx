import "@/styles/dashboard.css";
import DashboardApp from "@/components/dashboard/DashboardApp";
import { redirect } from "next/navigation";
import { DEV_USER_ID, getSessionUser } from "@/lib/session";
import { getDashboardOverview } from "@/lib/services/overview";
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

  let overview: OverviewData;
  if (process.env.LARAVEL_API_URL) {
    const token = (await cookies()).get("qfs_session")?.value ?? "";
    const response = await fetch(`${process.env.LARAVEL_API_URL.replace(/\/$/, "")}/api/dashboard/overview`, {
      headers: { Cookie: `qfs_session=${encodeURIComponent(token)}`, "Accept-Language": await getLocale() }, cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body?.error?.message ?? "Dashboard unavailable");
    overview = body.data as OverviewData;
  } else {
    overview = await getDashboardOverview(user.id);
  }
  return <><DashboardApp overview={overview} />{children}</>;
}
