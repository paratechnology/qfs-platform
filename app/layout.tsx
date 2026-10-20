import type { Metadata } from "next";
import "@fontsource-variable/dm-sans/index.css";
import "./globals.css";
import "@/styles/localization.css";
import "@/styles/feedback.css";
import ReferralCapture from "@/components/ReferralCapture";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { LANGUAGES } from "@/lib/i18n/locales";
import { getText } from "@/lib/i18n/server";
import { SITE_URL } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const tx = await getText();
  return {
    metadataBase: new URL(SITE_URL),
    title: tx("QFS – Your Financial Freedom Begins here"),
    description: tx("Unlock your financial freedom with QFS. Discover innovative solutions for secure and efficient financial management."),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    // Browser tools may add attributes to the document element before React hydrates.
    <html lang={locale} dir={LANGUAGES.find((language) => language.code === locale)?.direction ?? "ltr"} suppressHydrationWarning>
      <body suppressHydrationWarning><NextIntlClientProvider><ReferralCapture />{children}</NextIntlClientProvider></body>
    </html>
  );
}
