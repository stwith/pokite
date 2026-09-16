import { userFacingText } from "./messages.mjs";
import { createHash } from "node:crypto";

// UUIDv5 preserves the web queue's identity across retries and server restarts.
export function nativeRequestId(id) {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    return id;
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const bytes = createHash("sha1")
    .update(namespace)
    .update("agent-pocket.cowork:" + id)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function remoteSessionStatus(session) {
  if (session.status === "archived") return "idle";
  if (session.worker_status === "running") return "running";
  if (session.worker_status === "requires_action") return "waiting";
  if (["failed", "error"].includes(session.worker_status)) return "failed";
  if (session.worker_status === "idle") return "idle";
  return "unknown";
}

export function remoteMessages(events) {
  const rows = [...events].sort((a, b) => {
    const left = /^\d+$/.test(String(a.sequence_num))
      ? BigInt(a.sequence_num)
      : 0n;
    const right = /^\d+$/.test(String(b.sequence_num))
      ? BigInt(b.sequence_num)
      : 0n;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const messages = new Map();
  const acceptedRequestIds = new Set();
  for (const event of rows) {
    const p = event.payload;
    if (
      !p ||
      !["user", "assistant"].includes(p.type) ||
      p.parent_tool_use_id ||
      p.isMeta ||
      p.is_meta
    )
      continue;
    const id = p.uuid || event.event_id;
    if (typeof id !== "string") continue;
    if (p.type === "user") acceptedRequestIds.add(id);
    const blocks = p.message?.content;
    const raw =
      typeof blocks === "string"
        ? blocks
        : Array.isArray(blocks)
          ? blocks
              .filter((b) => b?.type === "text" && typeof b.text === "string")
              .map((b) => b.text)
              .join("\n")
          : "";
    const text = p.type === "user" ? userFacingText(raw) : raw;
    if (text)
      messages.set(id, { id, role: p.type, text, time: event.created_at });
  }
  return {
    messages: [...messages.values()],
    acceptedRequestIds: [...acceptedRequestIds],
  };
}

export function userEvent(sessionId, requestId, text) {
  if (
    typeof requestId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)
  )
    throw Error("Invalid message identity");
  if (typeof text !== "string" || !text.trim() || text.length > 50000)
    throw Error("Invalid message text");
  return {
    session_id: sessionId,
    events: [
      {
        payload: {
          uuid: nativeRequestId(requestId),
          type: "user",
          message: { role: "user", content: [{ type: "text", text }] },
        },
      },
    ],
  };
}
