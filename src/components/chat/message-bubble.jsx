import React, { lazy, Suspense } from "react";
import { stamp } from "@/lib/session";

const MarkdownContent = lazy(() => import("./markdown-content"));

export const MessageContent = React.memo(function MessageContent({ text }) {
  return <div className="markdown-body">
    <Suspense fallback={<div style={{ whiteSpace: "pre-wrap" }}>{text}</div>}>
      <MarkdownContent text={text} />
    </Suspense>
  </div>;
});

export const MessageBubble = React.memo(function MessageBubble({ role, text, time }) {
  return (
    <article className={"message " + role + (role === "user" ? " user-bubble" : "")}>
      <div className="message-meta"><time>{stamp(time)}</time></div>
      <MessageContent text={text} />
    </article>
  );
});
