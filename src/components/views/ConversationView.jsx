import { MessageSquare, Folder, X, Check, CircleAlert } from "lucide-react";
import { t } from "../../lib/i18n.js";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageBubble } from "../chat/message-bubble";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QueuedMessage } from "../chat/queued-message";
export function ConversationView({
  scroller,
  nearBottom,
  setShowLatest,
  loadOlder,
  sid,
  agents,
  project,
  projects,
  loading,
  selectedAgent,
  detail,
  older,
  historyBusy,
  answers,
  setAnswers,
  busy,
  answer,
  queueAction,
  bottom,
}) {
  return (
    <section
      className="conversation"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        nearBottom.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        setShowLatest(
          el.scrollHeight - el.scrollTop - el.clientHeight >
            Math.max(240, el.clientHeight / 2),
        );
        if (el.scrollTop < 120 && !nearBottom.current) void loadOlder();
      }}
    >
      {!sid ? (
        <div className="new-session">
          <MessageSquare size={32} />
          <h1>{agents.length ? t("新会话") : t("未发现可接入的本机会话")}</h1>
          <p>
            <Folder size={16} />
            {project?.name ||
              (!projects.length && !loading && selectedAgent?.emptyState) ||
              t("选择已有项目")}
          </p>
        </div>
      ) : loading && !detail ? (
        <div className="chat-skeleton" role="status" aria-label={t("加载会话")}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <div className="messages">
          {(older ? older.hasMore : detail?.hasMore) && (
            <div className="history-button" role="status">
              {historyBusy ? t("加载中…") : ""}
            </div>
          )}
          {[
            ...new Map(
              [...(older?.messages || []), ...(detail?.messages || [])].map(
                (m) => [m.id, m],
              ),
            ).values(),
          ].map((m) => (
            <MessageBubble
              key={m.id}
              role={m.role}
              text={m.text}
              time={m.time}
            />
          ))}
          {detail?.pending?.map((p) => (
            <section className="approval" key={p.id}>
              <strong>
                {p.kind === "question" ? t("需要你的回复") : t("等待审批")}
              </strong>
              {p.kind === "question" ? (
                p.questions?.map((q) => (
                  <label key={q.id}>
                    {q.question}
                    <Input
                      value={answers[q.id] || ""}
                      onChange={(e) =>
                        setAnswers({
                          ...answers,
                          [q.id]: e.target.value,
                        })
                      }
                    />
                    {q.options?.map((o) => (
                      <Button
                        variant="outline"
                        size="sm"
                        key={o.label}
                        onClick={() =>
                          setAnswers({
                            ...answers,
                            [q.id]: o.label,
                          })
                        }
                      >
                        {o.label}
                      </Button>
                    ))}
                  </label>
                ))
              ) : (
                <>
                  <pre>{p.title}</pre>
                  <p>{p.detail}</p>
                </>
              )}
              <div className="approval-actions">
                {p.kind === "approval" && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => answer(p, false)}
                  >
                    <X size={15} />
                    {t("拒绝")}
                  </Button>
                )}
                <Button disabled={busy} onClick={() => answer(p, true)}>
                  <Check size={15} />
                  {p.kind === "question" ? t("提交") : t("允许本次")}
                </Button>
              </div>
            </section>
          ))}
          {detail?.approvalNotice && (
            <p className="notification-hint" role="status">
              {t(detail.approvalNotice)}
            </p>
          )}
          {detail?.executionIssue && (
            <div
              className="execution-issue"
              role={detail.executionIssue.retrying ? "status" : "alert"}
            >
              <CircleAlert size={17} aria-hidden="true" />
              <div>
                <strong>
                  {detail.executionIssue.retrying
                    ? t("上游连接异常，Agent 正在自动重试")
                    : t("本轮执行失败")}
                </strong>
                <p>{detail.executionIssue.message}</p>
              </div>
            </div>
          )}
          {detail?.status === "running" && !detail.executionIssue && (
            <p className="working">
              <span />
              {detail.executionProgress || t("运行中")}
            </p>
          )}
          {detail?.liveExternal && (
            <p className="muted">{t("电脑端正在执行")}</p>
          )}
          {detail?.offline && (
            <p className="muted" role="status">
              {t("电脑端连接尚未就绪，排队消息将在连接恢复后处理。")}
            </p>
          )}
          {detail?.queue?.map((q) => (
            <QueuedMessage
              key={q.requestId}
              item={q}
              canEdit={!busy}
              onAction={queueAction}
            />
          ))}
          {detail?.status === "waiting" && !detail.pending?.length && (
            <p className="muted">{t("请在原 Agent 界面处理当前审批。")}</p>
          )}
          <div ref={bottom} />
        </div>
      )}
    </section>
  );
}
