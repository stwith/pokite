import { PanelLeftOpen, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n.js";
import { statuses } from "../../lib/session";
import { IconButton } from "../chat/controls";

// Title bar plus the sync, error and unsaved-storage banners.
export function MainHeader({
  agent,
  selectedAgent,
  project,
  sid,
  detail,
  syncErrors,
  error,
  setError,
  storageUnavailable,
  setNav,
  setDesktopNav,
}) {
  return (
    <>
      <header>
        <IconButton
          label={t("项目与会话")}
          onClick={() => {
            if (matchMedia("(max-width:760px)").matches) setNav(true);
            else setDesktopNav(true);
          }}
        >
          <PanelLeftOpen size={20} />
        </IconButton>
        <div className="header-titles">
          <span>
            {selectedAgent?.name} <span className="separator">/</span>{" "}
            {project?.name || t("项目")}
          </span>
          <strong>{detail?.title || (sid ? t("加载中…") : t("新会话"))}</strong>
        </div>
        <Badge
          variant="secondary"
          className={"status " + (detail?.status || "idle")}
        >
          {detail ? statuses[detail.status] || detail.status : ""}
        </Badge>
      </header>
      {Object.keys(syncErrors).length > 0 && (
        <div className="sync-banner" role="status">
          <span>
            {Object.entries(syncErrors)
              .map(([scope, message]) => scope + "：" + message)
              .join("；")}{" "}
            {t("· 正在重试")}
          </span>
          <IconButton
            label={t("立即重试")}
            onClick={async () => {
              try {
                if (selectedAgent?.capabilities?.connect)
                  await api("/" + agent + "/connect", {});
                window.dispatchEvent(new Event("online"));
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <RefreshCw size={16} />
          </IconButton>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <IconButton label={t("关闭提示")} onClick={() => setError("")}>
            <X size={17} />
          </IconButton>
        </div>
      )}
      {storageUnavailable && (
        <div className="error-banner" role="status">
          <span>
            {t(
              "部分本地数据尚未保存。当前输入保留在本页，刷新或关闭页面可能丢失。",
            )}
          </span>
        </div>
      )}
    </>
  );
}
