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
    if (open) void scan();
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
            <div className="setup-groups">
              {[true, false].map((connected) => {
                const rows = report.candidates.filter((c) =>
                  connected ? c.connected === true : c.connected !== true,
                );
                return (
                  rows.length > 0 && (
                    <section key={String(connected)}>
                      <h3 className="setup-group-title">
                        {t(connected ? "已连接" : "未连接")}
                      </h3>
                      <ul className="setup-results">
                        {rows.map((c) => (
                          <li key={c.id}>
                            <div className="setup-agent">
                              <span>{c.name}</span>
                              {report.canConfigure === false && !c.saved && (
                                <span className="setup-status">
                                  {t("请在电脑上添加此 Agent 接入")}
                                </span>
                              )}
                              {c.notice && (
                                <span className="setup-status">
                                  {t(c.notice)}
                                </span>
                              )}
                              {c.diagnostics?.length > 0 && (
                                <details className="setup-status">
                                  <summary>{t("连接诊断")}</summary>
                                  {c.diagnostics.map((note) => (
                                    <p key={note}>{t(note)}</p>
                                  ))}
                                </details>
                              )}
                            </div>
                            <Switch.Root
                              className="notification-switch"
                              checked={c.enabled}
                              disabled={
                                busy ||
                                (!c.enabled && !c.canEnable) ||
                                (report.canConfigure === false && !c.saved)
                              }
                              onCheckedChange={(enabled) =>
                                toggle(c.id, enabled)
                              }
                              aria-label={c.name}
                            >
                              <Switch.Thumb className="notification-switch-thumb" />
                            </Switch.Root>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                );
              })}
            </div>
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
