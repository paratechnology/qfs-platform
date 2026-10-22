import "server-only";

/** The Laravel API is the only persistence boundary for the frontend. */
export function laravelUrl(path: string): string {
  const origin = process.env.LARAVEL_API_URL?.replace(/\/$/, "");
  if (!origin) throw new Error("LARAVEL_API_URL must point to the Laravel API.");
  return `${origin}${path}`;
}
