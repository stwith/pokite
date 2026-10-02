import { en } from "./messages.mjs";
export const normalizeLocale = (value) =>
  /^en(?:[-_,;]|$)/i.test(value || "") ? "en" : "zh-CN";
export function translate(text, locale = "zh-CN") {
  if (typeof text !== "string" || normalizeLocale(locale) !== "en") return text;
  if (en[text] !== undefined) return en[text];
  if (en[text.trim()] !== undefined)
    return text.replace(text.trim(), en[text.trim()]);
  const http = text.match(/^Claude 请求未成功（HTTP (\d+)）。$/);
  if (http) return `Claude request failed (HTTP ${http[1]}).`;
  const hermes = text.match(/^Hermes Desktop 请求失败（HTTP (\d+)）$/);
  if (hermes) return `Hermes Desktop request failed (HTTP ${hermes[1]})`;
  const retry = text.match(
    /^(.*)，正在重试 (\d+)\/(\d+)，约 (\d+) 秒后再次尝试。$/s,
  );
  if (retry)
    return `${retry[1]} — retrying ${retry[2]}/${retry[3]} in approximately ${retry[4]} seconds.`;
  for (const prefix of ["会话已创建，消息未确认送达：", "会话已创建，消息尚未入队：", "消息尚未提交："])
    if (text.startsWith(prefix) && en[prefix])
      return en[prefix] + text.slice(prefix.length);
  return text;
}
// Translate only application-owned response fields, never titles, paths,
// conversation text, tool output, model labels or provider content.
const fields = new Set([
  "error",
  "reason",
  "readOnlyReason",
  "emptyState",
  "executionProgress",
  "blockedReason",
]);
export function localizeResponse(value, locale, key = "") {
  if (["messages", "text", "content", "title", "name", "path", "workspace", "cwd", "detail", "questions", "label"].includes(key)) return value;
  if (typeof value === "string")
    return fields.has(key) ? translate(value, locale) : value;
  if (Array.isArray(value))
    return value.map((v) => localizeResponse(v, locale));
  if (!value || typeof value !== "object") return value;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      key === "executionIssue" && k === "message"
        ? translate(v, locale)
        : localizeResponse(v, locale, k),
    ]),
  );
}
