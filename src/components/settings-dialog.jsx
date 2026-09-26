import { useState } from "react";
import { api, setAccessToken, persistAccessToken } from "../lib/api";
import { Settings, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { LanguageSelect } from "./language-select";
import { SetupDialog } from "./setup-dialog";
import { NotificationSettings } from "./notification-settings";
import { DisconnectDialog } from "./disconnect-dialog";
import { t } from "../lib/i18n.js";
export function SettingsDialog({ disabled }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [notificationRevision, setNotificationRevision] = useState(0);
  async function reset() {
    setResetting(true); setError("");
    try {
      const { token } = await api("/auth/reset", {});
      setAccessToken(token); persistAccessToken();
      setConfirmReset(false);
      setNotificationRevision(value => value + 1);
    } catch (e) { setError(e.message); }
    finally { setResetting(false); }
  }
  return (
    <Dialog defaultOpen={new URLSearchParams(location.search).has("setup")}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("设置")}>
          <Settings size={18} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="connection-title">{t("设置")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("管理语言、通知和 Agent 接入")}
        </DialogDescription>
        <div className="settings-items">
          <div className="settings-language">
            <span>{t("语言")}</span>
            <LanguageSelect />
          </div>
          <NotificationSettings key={notificationRevision} />
          <SetupDialog menuItem />
          {["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && <>
            {confirmReset ? <div className="settings-reset-confirm">
              <p className="notification-hint">{t("重置后，其他页面需使用新码连接并重新开启通知。")}</p>
              <div className="disconnect-actions">
                <Button size="sm" variant="ghost" disabled={resetting} onClick={() => setConfirmReset(false)}>{t("取消")}</Button>
                <Button size="sm" variant="outline" disabled={resetting} onClick={reset}>{t("确认重置")}</Button>
              </div>
            </div> : <Button variant="ghost" className="settings-item" onClick={() => setConfirmReset(true)}><RotateCcw size={18}/>{t("重置访问码")}</Button>}
            {error && <p role="alert" className="notification-error">{error}</p>}
          </>}
          <DisconnectDialog disabled={disabled} menuItem />
        </div>
      </DialogContent>
    </Dialog>
  );
}
