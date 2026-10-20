import { getText } from "@/lib/i18n/server";

export async function generateMetadata() {
  const tx = await getText();
  return { title: tx("Dashboard | QFS") };
}

export default function DashboardPage() {
  return null;
}
