"use server";

import { laravelUrl } from "../backend";
import { cookies } from "next/headers";
import { isAvailableLocale, LOCALE_COOKIE } from "./locales";

export async function setLanguage(locale: string) {
  if (!isAvailableLocale(locale)) throw new Error("Unsupported language");
  const store = await cookies();
  const token = store.get("qfs_session")?.value;
  if (token) {
    const response = await fetch(laravelUrl("/api/auth/locale"), {
      method: "POST", cache: "no-store", headers: {
        "Content-Type": "application/json", Cookie: `qfs_session=${encodeURIComponent(token)}`, "Accept-Language": locale,
      }, body: JSON.stringify({locale}),
    });
    if (!response.ok && response.status !== 401 && response.status !== 403) throw new Error("Could not save language");
  }
  store.set(LOCALE_COOKIE, locale, {
    path: "/", maxAge: 60 * 60 * 24 * 365, httpOnly: true,
    sameSite: "lax", secure: process.env.NODE_ENV === "production",
  });
}
