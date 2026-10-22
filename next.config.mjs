/** @type {import('next').NextConfig} */
import createNextIntlPlugin from "next-intl/plugin";

const isProd = process.env.NODE_ENV === "production";

/* Strict-ish CSP. Everything is served first-party; inline styles/scripts are
   needed by Next's hydration + the existing inline-style components. `unsafe-eval`
   and `ws:` are dev-only (React refresh / HMR). Everything else is locked down. */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: isProd ? '.next' : '.next-dev',
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    const backend = process.env.LARAVEL_API_URL?.replace(/\/$/, "");
    const adminAliases = [
      { source: "/admin", destination: "/user/admin" },
      { source: "/admin/:rest*", destination: "/user/admin/:rest*" },
    ];
    if (!backend) throw new Error("LARAVEL_API_URL must point to the Laravel API.");
    return {
      beforeFiles: [{ source: "/api/:path*", destination: `${backend}/api/:path*` }],
      afterFiles: adminAliases,
      fallback: [],
    };
  },
  async redirects() {
    return [
      { source: "/user/admin", destination: "/admin", permanent: false },
      { source: "/user/admin/:rest*", destination: "/admin/:rest*", permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default createNextIntlPlugin("./lib/i18n/request.ts")(nextConfig);
