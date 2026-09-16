export function presentSession(reads, agent, s) {
  const key = agent + ":" + s.id;
  const terminal = ["completed", "failed"].includes(s.status);
  const unread =
    typeof s.nativeUnread === "boolean"
      ? s.nativeUnread &&
        reads[key] !== s.revision &&
        !["running", "waiting"].includes(s.status)
      : terminal &&
        !!reads["initialized:v2:" + agent + ":" + s.projectId] &&
        reads[key] !== s.revision;
  return {
    ...s,
    unread,
    status: s.status === "completed" && !unread ? "idle" : s.status,
  };
}
