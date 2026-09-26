import { useState } from "react";
import { Settings2 } from "lucide-react";
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
export function SetupDialog() {
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
  async function configure(action) {
    setBusy(true);
    setMessage("");
    try {
      await api("/setup/configure", { action });
      setMessage(
        t(
          "配置已保存。请从菜单栏重启 Pokite 服务；共享启用后，等待任务结束再重新打开对应 Desktop。",
        ),
      );
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void scan();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("接入设置")}>
          <Settings2 size={18} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="connection-title">
          {t("接入你的 Agent")}
        </DialogTitle>
        <DialogDescription className="connection-description">
          {t(
            "先发现电脑上已有的项目和会话，再按需要启用共享。不会自动重启 Desktop。",
          )}
        </DialogDescription>
        <Button variant="outline" disabled={busy} onClick={scan}>
          {t("检测本机 Agent")}
        </Button>
        {report && (
          <>
            <ul className="setup-results">
              {report.candidates.map((c, i) => (
                <li key={c.id || i}>
                  {c.name || c.provider}
                  <span>{c.status}</span>
                </li>
              ))}
            </ul>
            <div className="setup-actions">
              <Button disabled={busy} onClick={() => configure("save")}>
                {t("保存已发现的接入")}
              </Button>
              {report.instances.some((x) => x.provider === "codex") && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => configure("codex")}
                >
                  {t("启用 Codex 共享")}
                </Button>
              )}
              {report.instances.some((x) => x.provider === "hermesDesktop") && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => configure("hermes")}
                >
                  {t("安装 Hermes 共享插件")}
                </Button>
              )}
            </div>
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
