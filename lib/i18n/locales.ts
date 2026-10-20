import available from "./available.json";

export const LANGUAGES = [
  { code: "en", name: "English", direction: "ltr" },
  { code: "es", name: "Español", direction: "ltr" },
  { code: "fr", name: "Français", direction: "ltr" },
  { code: "de", name: "Deutsch", direction: "ltr" },
  { code: "it", name: "Italiano", direction: "ltr" },
  { code: "pt", name: "Português", direction: "ltr" },
  { code: "nl", name: "Nederlands", direction: "ltr" },
  { code: "pl", name: "Polski", direction: "ltr" },
  { code: "ru", name: "Русский", direction: "ltr" },
  { code: "tr", name: "Türkçe", direction: "ltr" },
  { code: "ar", name: "العربية", direction: "rtl" },
  { code: "hi", name: "हिन्दी", direction: "ltr" },
  { code: "bn", name: "বাংলা", direction: "ltr" },
  { code: "ur", name: "اردو", direction: "rtl" },
  { code: "zh-CN", name: "简体中文", direction: "ltr" },
  { code: "zh-TW", name: "繁體中文", direction: "ltr" },
  { code: "ja", name: "日本語", direction: "ltr" },
  { code: "ko", name: "한국어", direction: "ltr" },
  { code: "id", name: "Bahasa Indonesia", direction: "ltr" },
  { code: "vi", name: "Tiếng Việt", direction: "ltr" },
  { code: "th", name: "ไทย", direction: "ltr" },
] as const;

export type Locale = (typeof LANGUAGES)[number]["code"];
export const LOCALE_COOKIE = "qfs_locale";
export const AVAILABLE_LANGUAGES = LANGUAGES.filter((language) => available.includes(language.code));

export function isAvailableLocale(value: unknown): value is Locale {
  return typeof value === "string" && AVAILABLE_LANGUAGES.some((language) => language.code === value);
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LANGUAGES.some((language) => language.code === value);
}

export function resolveLocale(saved?: string, accepted = "", publishedOnly = false): Locale {
  const languages = publishedOnly ? AVAILABLE_LANGUAGES : LANGUAGES;
  if (languages.some((language) => language.code === saved)) return saved as Locale;
  const choices = accepted.split(",").map((entry) => {
    const [tag, ...options] = entry.trim().split(";");
    const quality = options.find((option) => option.trim().startsWith("q="));
    return { tag: tag.toLowerCase(), quality: quality ? Number(quality.trim().slice(2)) : 1 };
  }).filter((entry) => Number.isFinite(entry.quality) && entry.quality > 0 && entry.quality <= 1)
    .sort((a, b) => b.quality - a.quality);
  for (const { tag } of choices) {
    if (tag === "zh" || tag.startsWith("zh-")) {
      const chinese = /(?:tw|hk|mo|hant)/.test(tag) ? "zh-TW" : "zh-CN";
      if (languages.some((language) => language.code === chinese)) return chinese;
      continue;
    }
    const language = languages.find((item) => item.code.toLowerCase() === tag || item.code === tag.split("-")[0]);
    if (language) return language.code;
  }
  return "en";
}

export function catalogSection(path: string) {
  if (path.startsWith("/admin") || path.startsWith("/user/admin")) return "admin";
  if (path.startsWith("/user/user/dashboard") || path.startsWith("/user/user/connect")) return "account";
  return "public";
}

// Stable source keys keep translations intact when a component moves to another file.
export function messageKey(source: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(source)) {
    hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  }
  return `m${hash.toString(16).padStart(8, "0")}`;
}
