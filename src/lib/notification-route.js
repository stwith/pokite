export function notificationRoute(href, origin) {
  const url = new URL(href, origin);
  if (url.origin !== origin || url.pathname !== "/") return null;
  const agent = url.searchParams.get("agent"),
    project = url.searchParams.get("project"),
    session = url.searchParams.get("session");
  if (
    ![agent, project, session].every(
      (v) => typeof v === "string" && v.length > 0 && v.length <= 1000,
    )
  )
    return null;
  if (!/^[\w-]+$/.test(agent)) return null;
  return { agent, project, session };
}
