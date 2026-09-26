import { normalizeLocale, translate } from "../../shared/i18n.mjs";
import { browserStorage } from "./browser-storage.js";
export const locale = normalizeLocale(
  typeof window === "undefined"
    ? "zh-CN"
    : browserStorage.getItem("language") || navigator.language,
);
export const t = (text) => translate(text, locale);
export function setLocale(value) {
  browserStorage.setItem("language", normalizeLocale(value));
  location.reload();
}
