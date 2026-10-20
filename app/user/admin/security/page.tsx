"use client";
import AccountSettings from "@/components/dashboard/AccountSettings";
import { PageHeader } from "@/components/admin/ui";
import { useText } from "@/lib/i18n/text";
export default function SecurityPage() {
  const tx = useText();
  return <><PageHeader title={tx("Account security")} subtitle={tx("Manage your administrator profile, sign-in protection and active sessions.")} /><AccountSettings /></>;
}
