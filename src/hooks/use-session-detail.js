import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n.js";
import { watchResource } from "./use-session-sync";

// The open session: polled every 2.5s, acknowledged as read while the reader
// is at the bottom, and paged backwards on demand or automatically while the
// transcript does not fill the viewport. Older pages keep the scroll anchor.
export function useSessionDetail({
  agent,
  sid,
  active,
  scroller,
  nearBottom,
  setSessions,
  setLoading,
  setOnline,
  setError,
  syncFailed,
  syncRecovered,
}) {
  const [detail, setDetail] = useState(null),
    [older, setOlder] = useState(null),
    [historyBusy, setHistoryBusy] = useState(false);
  const historyRequest = useRef(null),
    autoHistoryCursor = useRef(null),
    historyAnchor = useRef(null);
  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    historyAnchor.current = null;
    if (
      anchor &&
      anchor.agent === agent &&
      anchor.sid === sid &&
      scroller.current === anchor.element
    ) {
      anchor.element.scrollTop =
        anchor.top + anchor.element.scrollHeight - anchor.height;
    }
  }, [older, agent, sid]);
  useEffect(() => {
    syncRecovered(t("会话内容"));
    autoHistoryCursor.current = null;
    if (!sid) {
      setDetail(null);
      return;
    }
    let alive = true,
      working = false;
    let acknowledgementInFlight = false,
      acknowledgedRevision = null;
    setLoading(true);
    setDetail(null);
    setOlder(null);
    nearBottom.current = true;
    async function refresh() {
      if (working || document.hidden) return;
      working = true;
      try {
        const d = await api(
          "/" + agent + "/sessions/" + encodeURIComponent(sid),
        );
        if (alive) {
          setDetail(d);
          setOnline(true);
          syncRecovered(t("会话内容"));
          setSessions((rows) =>
            rows.map((s) =>
              s.id === sid
                ? {
                    ...s,
                    ...d,
                    messages: undefined,
                  }
                : s,
            ),
          );
          if (nearBottom.current && !document.hidden) {
            if (
              !acknowledgementInFlight &&
              acknowledgedRevision !== d.revision
            ) {
              acknowledgementInFlight = true;
              void api(
                "/" + agent + "/sessions/" + encodeURIComponent(sid) + "/read",
                {
                  revision: d.revision,
                },
              )
                .then((result) => {
                  if (!result.ok) return;
                  acknowledgedRevision = d.revision;
                  if (alive) {
                    const read = (s) =>
                      s?.revision === d.revision
                        ? {
                            ...s,
                            unread: false,
                            status:
                              s.status === "completed" ? "idle" : s.status,
                          }
                        : s;
                    setDetail(read);
                    setSessions((rows) =>
                      rows.map((s) => (s.id === sid ? read(s) : s)),
                    );
                  }
                })
                .catch(() => {})
                .finally(() => {
                  acknowledgementInFlight = false;
                });
            }
            setTimeout(() => {
              if (alive && nearBottom.current)
                if (scroller.current)
                  scroller.current.scrollTop = scroller.current.scrollHeight;
            }, 30);
          }
        }
      } catch (e) {
        if (alive) {
          setOnline(false);
          syncFailed(t("会话内容"), e);
        }
      } finally {
        working = false;
        if (alive) setLoading(false);
      }
    }
    const stopRefresh = watchResource(agent, refresh, 2500, {
      once: false,
    });
    return () => {
      alive = false;
      stopRefresh();
    };
  }, [agent, sid]);
  async function loadOlder(automatic = false) {
    if (
      historyRequest.current ||
      !detail ||
      !(older ? older.hasMore : detail.hasMore)
    )
      return;
    const context = {
      agent,
      sid,
    };
    historyRequest.current = context;
    const cursor = older ? older.historyCursor : detail.historyCursor;
    setHistoryBusy(true);
    if (!automatic) nearBottom.current = false;
    const element = scroller.current;
    const height = element?.scrollHeight || 0;
    const top = element?.scrollTop || 0;
    try {
      const h = await api(
        "/" +
          agent +
          "/sessions/" +
          encodeURIComponent(sid) +
          "/history?before=" +
          encodeURIComponent(cursor),
      );
      if (
        active.current.agent !== context.agent ||
        active.current.sid !== context.sid
      )
        return;
      historyAnchor.current = {
        ...context,
        element,
        height,
        top,
      };
      autoHistoryCursor.current = null;
      setOlder((prev) => ({
        ...h,
        messages: [...h.messages, ...(prev?.messages || [])],
      }));
    } catch (e) {
      if (
        active.current.agent === context.agent &&
        active.current.sid === context.sid
      ) {
        const previous = autoHistoryCursor.current;
        const attempts = (previous?.attempts || 0) + 1;
        autoHistoryCursor.current = {
          key: JSON.stringify([context.agent, context.sid, cursor]),
          attempts,
          retryAt:
            Date.now() + Math.min(30000, 1000 * 2 ** Math.min(attempts - 1, 5)),
        };
        setError(e.message);
      }
    } finally {
      historyRequest.current = null;
      setHistoryBusy(false);
    }
  }
  useEffect(() => {
    const el = scroller.current;
    const more = older ? older.hasMore : detail?.hasMore;
    const cursor = older ? older.historyCursor : detail?.historyCursor;
    const key = JSON.stringify([agent, sid, cursor]);
    if (el && more && !historyBusy && el.scrollHeight <= el.clientHeight + 1) {
      const retry = autoHistoryCursor.current;
      const delay =
        retry?.key === key ? Math.max(0, retry.retryAt - Date.now()) : 0;
      const timer = setTimeout(() => void loadOlder(true), delay);
      return () => clearTimeout(timer);
    }
  }, [agent, sid, detail, older, historyBusy]);
  return { detail, setDetail, older, historyBusy, loadOlder };
}
