export const statuses = {
  idle: "空闲",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  waiting: "等待处理",
  unknown: "状态待确认",
};
export const requestId = () => {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => n.toString(16).padStart(2, "0")).join("");
};
export const stamp = (t) =>
  t
    ? new Date(t).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
