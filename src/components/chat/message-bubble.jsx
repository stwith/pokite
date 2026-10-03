import React, { lazy, Suspense } from "react";
import { CopyButton } from "../copy-button";
import { t } from "@/lib/i18n.js";
import { stamp } from "@/lib/session";

const MarkdownContent = lazy(() => import("./markdown-content"));

export const MessageContent = React.memo(function MessageContent({ text, fileContext }) {
  return (
    <div className="markdown-body">
      <Suspense fallback={<div style={{ whiteSpace: "pre-wrap" }}>{text}</div>}>
        <MarkdownContent text={text} fileContext={fileContext} />
      </Suspense>
    </div>
  );
});

export const MessageBubble = React.memo(function MessageBubble({
  role,
  text,
  time,
  fileContext,
}) {
  return (
    <article
      className={"message " + role + (role === "user" ? " user-bubble" : "")}
    >
      <div className="message-meta">
        <time>{stamp(time)}</time>
        <CopyButton url={text || ""} label={t("复制消息")} className="message-copy" />
      </div>
      <MessageContent text={text} fileContext={fileContext} />
    </article>
  );
});
