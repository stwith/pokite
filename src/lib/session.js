import { t, locale } from "./i18n.js";
export const statuses = {
  idle: t("空闲"),
  running: t("运行中"),
  completed: t("已完成"),
  failed: t("失败"),
  interrupted: t("已中断"),
  waiting: t("等待处理"),
  unknown: t("状态待确认"),
};
export const requestId = () => {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => n.toString(16).padStart(2, "0")).join("");
};
export const stamp = (t) =>
  t
    ? new Date(t).toLocaleString(locale, {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
