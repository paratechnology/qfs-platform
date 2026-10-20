import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { messageKey } from "./locales";

export function createText(translate: ReturnType<typeof useTranslations>, locale: string) {
  const text = (source: string | null | undefined, values?: Record<string, unknown>): string => {
    if (!source) return "";
    const key = messageKey(source);
    const parameters = values && Object.fromEntries(Object.entries(values).map(([name, value]) => [name,
      typeof value === "number" || typeof value === "string" ? value : value == null ? "" : String(value),
    ]));
    if (translate.has(key)) return translate(key, parameters);
    return values ? source.replace(/\{(\w+)\}/g, (match, name) => name in values ? String(values[name] ?? "") : match) : source;
  };
  return Object.assign(text, {
    locale,
    number: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(value),
    money: (cents: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(cents / 100),
    date: (value: string | Date, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, {
      year: "numeric", month: "short", day: "numeric", timeZone: "UTC", calendar: "gregory", ...options,
    }).format(new Date(value)),
  });
}

export function useText() {
  const translate = useTranslations("ui");
  const locale = useLocale();
  return useMemo(() => createText(translate, locale), [translate, locale]);
}
