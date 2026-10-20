import "@/styles/dashboard.css";
import "@/styles/admin.css";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/user/user/dashboard");

  return (
    <AdminShell user={{ name: user.name, email: user.email, avatarUrl: user.avatarUrl }}>
      {children}
    </AdminShell>
  );
}
