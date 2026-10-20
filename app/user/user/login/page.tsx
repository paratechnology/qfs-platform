
import { getText } from "@/lib/i18n/server";
import AuthLayout, { AuthField as Field, AuthLink } from "@/components/AuthLayout";
import { Lock, Mail } from "@/components/icons";
import PasswordField from "@/components/PasswordField";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const tx = await getText();
  return (
    <AuthLayout
      eyebrow={tx("Welcome Back")}
      title={tx("Log In to Your Account")}
      subtitle={tx("Access your QFS dashboard, wallets and trading history.")}
      submitLabel={tx("Log In")}
      to="/user/user/dashboard"
      endpoint="/api/auth/login"
      footer={
        <p>{tx("Don't have an account?")}{" "}
          <AuthLink href="/user/user/register">{tx("Create one")}</AuthLink>
        </p>
      }
    >
      <Field
        label={tx("Email Address")}
        type="email"
        id="login-email"
        name="email"
        placeholder="you@example.com"
        autoComplete="email"
        icon={<Mail />}
      />
      <PasswordField
        label={tx("Password")}
        id="login-password"
        name="password"
        placeholder={tx("Enter your password")}
        autoComplete="current-password"
        icon={<Lock />}
      />
      <div className="auth-form-row">
        <AuthLink href="/forgot-password">{tx("Forgot password?")}</AuthLink>
      </div>
    </AuthLayout>
  );
}
