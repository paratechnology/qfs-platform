
import { getText } from "@/lib/i18n/server";
import AuthLayout, { AuthField as Field, AuthLink } from "@/components/AuthLayout";
import { Globe, Lock, Mail, Phone, User } from "@/components/icons";
import PasswordField from "@/components/PasswordField";
import EmailField from "@/components/EmailField";

export const dynamic = "force-dynamic";

const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "Ghana",
  "Nigeria",
  "South Africa",
  "Kenya",
  "Egypt",
  "Germany",
  "France",
  "Netherlands",
  "Spain",
  "Italy",
  "Switzerland",
  "India",
  "Pakistan",
  "Bangladesh",
  "United Arab Emirates",
  "Saudi Arabia",
  "Brazil",
  "Mexico",
  "China",
  "Japan",
  "Singapore",
  "Philippines",
  "Indonesia",
  "Other",
];

export default async function RegisterPage() {
  const tx = await getText();
  return (
    <AuthLayout
      eyebrow={tx("Create Account")}
      title={tx("Register for QFS")}
      subtitle={tx("Set up your QFS account to access wallets, trading and payments.")}
      submitLabel={tx("Create Account")}
      to="/user/user/dashboard"
      endpoint="/api/auth/register"
      footer={
        <p>{tx("Already have an account?")}{" "}
          <AuthLink href="/user/user/login">{tx("Log in")}</AuthLink>
        </p>
      }
    >
      <div className="auth-row">
        <Field
          label={tx("First Name")}
          type="text"
          id="register-first"
          name="firstName"
          placeholder={tx("Your first name")}
          autoComplete="given-name"
          icon={<User />}
        />
        <Field
          label={tx("Last Name")}
          type="text"
          id="register-last"
          name="lastName"
          placeholder={tx("Your last name")}
          autoComplete="family-name"
          icon={<User />}
        />
      </div>
      <EmailField
        label={tx("Email Address")}
        id="register-email"
        name="email"
        placeholder="you@example.com"
        autoComplete="email"
        icon={<Mail />}
      />
      <Field
        label={tx("Country")}
        id="register-country"
        name="country"
        placeholder={tx("Select your country")}
        icon={<Globe />}
        select
        options={COUNTRIES}
      />
      <Field
        label={tx("Phone Number")}
        type="tel"
        id="register-phone"
        name="phone"
        placeholder="+1 (555) 000-0000"
        autoComplete="tel"
        icon={<Phone />}
      />
      <PasswordField
        label={tx("Password")}
        id="register-password"
        name="password"
        placeholder={tx("Create a password")}
        autoComplete="new-password"
        icon={<Lock />}
      />
      <PasswordField
        label={tx("Confirm Password")}
        id="register-confirm"
        name="confirmPassword"
        placeholder={tx("Re-type your password")}
        autoComplete="new-password"
        icon={<Lock />}
      />
    </AuthLayout>
  );
}
