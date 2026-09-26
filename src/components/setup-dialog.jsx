import { useEffect, useState } from "react";
import { Settings2, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";
import { api } from "../lib/api";
import { t } from "../lib/i18n.js";
import { setupStatuses } from "../lib/setup-status";
export function SetupDialog({ menuItem = false }) {
  const [open, setOpen] = useState(
    new URLSearchParams(location.search).has("setup"),
  );
  const [report, setReport] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  async function scan() {
    setBusy(true);
    setMessage("");
    try {
      setReport(await api("/setup/discovery"));
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (open && local) void scan();
  }, [open]);
  async function configure(action, instanceId) {
    setBusy(true);
    setMessage("");
    try {
      await api("/setup/configure", { action, instanceId });
      setReport(await api("/setup/discovery"));
      setMessage(
        t(
          "配置已保存。请在电脑上重启 Pokite 服务；共享启用后，等待任务结束再重新打开对应 Desktop。",
        ),
      );
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!local) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size={menuItem ? "default" : "icon-sm"}
          className={menuItem ? "settings-item" : undefined}
          aria-label={t("Agent 接入")}
        >
          <Settings2 size={18} />
          {menuItem && t("Agent 接入")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="connection-title">
          {t("Agent 接入")}
        </DialogTitle>
        <DialogDescription className="connection-description">
          {t("查看电脑上的 Agent，按需开启共享。")}
        </DialogDescription>
        <div className="setup-toolbar">
          <span>{t("本机 Agent")}</span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={scan}>
            <RefreshCw
              size={14}
              className={busy ? "animate-spin" : undefined}
            />
            {busy ? t("检测中…") : t("重新检测")}
          </Button>
        </div>
        {!report && (
          <p className="notification-hint" role="status">
            {busy ? t("正在检测本机 Agent…") : t("暂无检测结果")}
          </p>
        )}
        {report && (
          <>
            <ul className="setup-results">
              {report.candidates.map((c, i) => (
                <li key={c.id || i}>
                  <div className="setup-agent">
                    <span>{c.name || c.provider}</span>
                    <span className="setup-status">
                      {t(setupStatuses[c.status] || "待确认")}
                    </span>
                  </div>
                  {c.setupAction && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => configure(c.setupAction, c.id)}
                    >
                      {c.setupAction === "codex"
                        ? t("开启共享")
                        : t("安装插件")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!report.candidates.length && (
              <p className="notification-hint">{t("未检测到支持的 Agent")}</p>
            )}
            {report.needsSave && (
              <div className="setup-actions">
                <Button disabled={busy} onClick={() => configure("save")}>
                  {t("添加到 Pokite")}
                </Button>
              </div>
            )}
          </>
        )}
        {message && (
          <p role="status" className="notification-hint">
            {message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
