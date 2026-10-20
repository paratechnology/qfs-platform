/** Public links are canonical; sessions remain scoped to the browser's current host. */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://q-arculuspro.live").replace(/\/+$/, "");
export const SITE_HOST = new URL(SITE_URL).host;
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@q-arculuspro.live";
export const SUPPORT_HREF = `mailto:${SUPPORT_EMAIL}`;

export function referralLink(code: string): string {
  return `${SITE_URL}/user/user/register?ref=${encodeURIComponent(code)}`;
}
