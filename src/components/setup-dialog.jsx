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
import { Switch } from "radix-ui";
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
  async function toggle(instanceId, enabled) {
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/setup/toggle", { instanceId, enabled });
      setReport(await api("/setup/discovery"));
      setMessage(result.notice || "");
      window.dispatchEvent(new Event("pokite:agents-changed"));
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
          {t("选择在 Pokite 中使用的 Agent，不会关闭电脑上的应用。")}
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
                    <span>{c.name}</span>
                    {c.notice && (
                      <span className="setup-status">{t(c.notice)}</span>
                    )}
                  </div>
                  <Switch.Root
                    className="notification-switch"
                    checked={c.enabled}
                    disabled={busy || (!c.enabled && !c.canEnable)}
                    onCheckedChange={(enabled) => toggle(c.id, enabled)}
                    aria-label={c.name}
                  >
                    <Switch.Thumb className="notification-switch-thumb" />
                  </Switch.Root>
                </li>
              ))}
            </ul>
            {!report.candidates.length && (
              <p className="notification-hint">{t("未检测到支持的 Agent")}</p>
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
