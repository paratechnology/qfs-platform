import AccountRecovery from "@/components/AccountRecovery";
import { getText } from "@/lib/i18n/server";

export async function generateMetadata() {
  const tx = await getText();
  return { title: `${tx("Account recovery")} | QFS` };
}
export default function ForgotPasswordPage() { return <AccountRecovery />; }
