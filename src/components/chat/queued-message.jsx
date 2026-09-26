import { t } from "../../lib/i18n.js";
import { useState } from "react";
import { Pencil, X, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageContent } from "./message-bubble";
export function QueuedMessage({ item, onAction, canEdit }) {
  const [busy, setBusy] = useState(false);
  const act = async (action) => {
    setBusy(true);
    try {
      await onAction(item, action);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="message user-bubble queued-message" data-state={item.state}>
      <div className="queued-message-header">
        <span className="queued-message-status">
          <Clock3 size={13} aria-hidden="true" />
          {item.state === "queued"
            ? item.native
              ? t("Agent 队列中")
              : t("排队中")
            : item.state === "sending"
              ? t("提交中")
              : item.state === "blocked"
                ? t("未发送")
                : t("待确认")}
        </span>
        {!item.native && (
          <div className="queued-message-actions">
            {["queued", "blocked"].includes(item.state) && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("撤回编辑")}
                disabled={busy || !canEdit}
                onClick={() => act("withdraw")}
              >
                <Pencil size={14} />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("移除排队消息")}
              disabled={busy || item.state === "sending"}
              onClick={() => act("remove")}
            >
              <X size={14} />
            </Button>
          </div>
        )}
      </div>
      <MessageContent text={item.text} />
      {item.error && <small>{item.error}</small>}
      {item.state === "uncertain" && (
        <small role="status">
          {t(
            "为避免重复执行，后续消息已暂停。请先查看原会话确认是否送达，再点右上角 × 移除此待确认记录，队列才会继续。移除记录不会撤销已执行的任务。",
          )}
        </small>
      )}
    </div>
  );
}
