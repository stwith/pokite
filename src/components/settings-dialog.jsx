import { Settings } from "lucide-react";
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
          <NotificationSettings menuItem />
          <SetupDialog menuItem />
          <DisconnectDialog disabled={disabled} menuItem />
        </div>
      </DialogContent>
    </Dialog>
  );
}
