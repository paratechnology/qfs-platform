import "server-only";
import { getLocale, getTranslations } from "next-intl/server";
import { createText } from "./text";

export async function getText() {
  return createText(await getTranslations("ui"), await getLocale());
}
