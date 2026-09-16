import { useState } from "react";
import { Pencil, X, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="queued-message">
      <div className="queued-message-header">
        <span className="queued-message-status">
          <Clock3 size={13} aria-hidden="true" />
          {item.state === "queued"
            ? item.native
              ? "Agent 队列中"
              : "排队中"
            : item.state === "sending"
              ? "提交中"
              : "待确认"}
        </span>
        {!item.native && (
          <div className="queued-message-actions">
            {item.state === "queued" && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="撤回编辑"
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
              aria-label="移除排队消息"
              disabled={busy || item.state === "sending"}
              onClick={() => act("remove")}
            >
              <X size={14} />
            </Button>
          </div>
        )}
      </div>
      <p>{item.text}</p>
      {item.error && <small>{item.error}</small>}
    </div>
  );
}
