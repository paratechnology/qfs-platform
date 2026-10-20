import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { catalogSection, LOCALE_COOKIE, resolveLocale } from "./locales";

export default getRequestConfig(async () => {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value, requestHeaders.get("accept-language") ?? "", true);
  const section = catalogSection(requestHeaders.get("x-qfs-path") ?? "/");
  const english = (await import("./catalogs/en.json")).default;
  const catalog = locale === "en" ? english : await import(`./catalogs/${locale}.json`).then((module) => module.default).catch(() => english);
  return {
    locale, timeZone: "UTC",
    messages: { ui: { ...english.common, ...english[section], ...catalog.common, ...catalog[section] } },
  };
});
