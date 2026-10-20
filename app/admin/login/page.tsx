
import { getText } from "@/lib/i18n/server";
import AuthLayout, { AuthField as Field, AuthLink } from "@/components/AuthLayout";
import { Lock, Mail } from "@/components/icons";
import PasswordField from "@/components/PasswordField";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const tx = await getText();
  return (
    <AuthLayout
      eyebrow={tx("QFS Control Center")}
      title={tx("Admin Sign In")}
      subtitle={tx("Sign in with your administrator account.")}
      submitLabel={tx("Sign In")}
      to="/admin"
      endpoint="/api/auth/login"
      footer={<p>{tx("Looking for your account?")}<AuthLink href="/user/user/login">{tx("User sign in")}</AuthLink></p>}
    >
      <Field
        label={tx("Email Address")}
        type="email"
        id="admin-email"
        name="email"
        placeholder="you@example.com"
        autoComplete="email"
        icon={<Mail />}
      />
      <PasswordField
        label={tx("Password")}
        id="admin-password"
        name="password"
        placeholder={tx("Enter your password")}
        autoComplete="current-password"
        icon={<Lock />}
      />
      <div className="auth-form-row"><AuthLink href="/forgot-password">{tx("Forgot password?")}</AuthLink></div>
    </AuthLayout>
  );
}
