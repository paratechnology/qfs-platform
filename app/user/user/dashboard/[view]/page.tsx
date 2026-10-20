import { notFound } from "next/navigation";
import { ACCOUNT_VIEWS, type AccountView } from "@/components/dashboard/views";
import { getText } from "@/lib/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const tx = await getText();
  return { title: `${tx(ACCOUNT_VIEWS[view as AccountView]?.title ?? "Account")} | QFS` };
}

export default async function AccountPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!Object.hasOwn(ACCOUNT_VIEWS, view) || view === "dashboard") notFound();
  return null;
}
