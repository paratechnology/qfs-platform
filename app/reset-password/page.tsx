import AccountRecovery from "@/components/AccountRecovery";
import { getText } from "@/lib/i18n/server";

export async function generateMetadata() {
  const tx = await getText();
  return { title: `${tx("Reset password")} | QFS`, robots: { index: false, follow: false } };
}
export default function ResetPasswordPage() { return <AccountRecovery reset />; }
