import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n.js";
import { watchResource } from "./use-session-sync";

// Sessions of the selected project, polled every 5s. The page size grows as
// the sidebar scrolls and resets when the agent, project or search changes.
export function useSessionList({
  agent,
  project,
  filter,
  setOnline,
  syncFailed,
  syncRecovered,
}) {
  const [sessions, setSessions] = useState([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionLimit, setSessionLimit] = useState(40);
  const [sessionHasMore, setSessionHasMore] = useState(false);
  const sessionPagePending = useRef(false);
  useEffect(() => {
    setSessionLimit(40);
    setSessionHasMore(false);
  }, [agent, project?.id, filter]);
  useEffect(() => {
    if (!project) return;
    let alive = true,
      working = false;
    syncRecovered(t("会话列表"));
    setSessionLoading(true);
    async function refresh() {
      if (working || document.hidden) return;
      working = true;
      try {
        const rows = await api(
          "/" +
            agent +
            "/sessions?projectId=" +
            encodeURIComponent(project.id) +
            "&limit=" +
            sessionLimit +
            "&search=" +
            encodeURIComponent(filter),
        );
        if (alive) {
          setSessions(Array.isArray(rows) ? rows : rows.items);
          setSessionHasMore(!Array.isArray(rows) && !!rows.nextCursor);
          setOnline(true);
          syncRecovered(t("会话列表"));
        }
      } catch (e) {
        if (alive) {
          setOnline(false);
          syncFailed(t("会话列表"), e);
        }
      } finally {
        working = false;
        if (alive) {
          sessionPagePending.current = false;
          setSessionLoading(false);
        }
      }
    }
    const stopRefresh = watchResource(agent, refresh, 5000, {
      once: false,
    });
    return () => {
      alive = false;
      stopRefresh();
    };
  }, [agent, project?.id, sessionLimit, filter]);
  return {
    sessions,
    setSessions,
    sessionLoading,
    sessionLimit,
    setSessionLimit,
    sessionHasMore,
    sessionPagePending,
  };
}
