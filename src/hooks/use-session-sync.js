import { useEffect } from "react";
import { getAccessToken } from "../lib/api";
import { createRefreshLoop } from "../lib/resource-refresh";
import { createReconnectBackoff } from "../lib/reconnect-backoff";

const connected = new Set();
function setConnected(agent, value) {
  const previous = connected.has(agent);
  if (value) connected.add(agent);
  else connected.delete(agent);
  if (previous !== value)
    window.dispatchEvent(
      new CustomEvent("pocket-sync-status", { detail: { agent } }),
    );
}
export function useSessionSync(enabled, agent) {
  useEffect(() => {
    if (!enabled) return;
    const backoff = createReconnectBackoff();
    let stopped = false,
      controller,
      retry;
    const notify = () =>
      window.dispatchEvent(
        new CustomEvent("pocket-session-change", { detail: { agent } }),
      );
    const stop = () => {
      clearTimeout(retry);
      const old = controller;
      controller = null;
      old?.abort();
      setConnected(agent, false);
    };
    async function connect() {
      stop();
      if (stopped || document.hidden || !navigator.onLine) return;
      const current = new AbortController();
      controller = current;
      let watchdog;
      try {
        watchdog = setTimeout(() => current.abort(), 45000);
        const response = await fetch("/api/" + agent + "/events", {
          headers: { Authorization: "Bearer " + getAccessToken() },
          signal: current.signal,
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        )
          throw Error("Events unavailable");
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (!current.signal.aborted) {
          const { value, done } = await reader.read();
          if (done || current.signal.aborted || controller !== current) break;
          clearTimeout(watchdog);
          watchdog = setTimeout(() => current.abort(), 45000);
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 65536) throw Error("Invalid event frame");
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = frame
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (!data) continue;
            const event = JSON.parse(data.slice(6));
            if (event.type === "heartbeat") backoff.reset();
            if (event.type === "ready") {
              setConnected(agent, true);
              notify();
            }
            if (event.type === "change") notify();
          }
        }
      } catch {
        /* Resource polling continues during a stream outage. */
      } finally {
        clearTimeout(watchdog);
        current.abort();
        if (controller === current) {
          setConnected(agent, false);
          if (!stopped && !document.hidden && navigator.onLine !== false)
            retry = setTimeout(connect, backoff.next());
        }
      }
    }
    const reconnect = () => {
      backoff.reset();
      void connect();
    };
    const visibility = () => {
      if (document.hidden) stop();
      else reconnect();
    };
    void connect();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", stop);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", stop);
    };
  }, [enabled, agent]);
}

export function watchResource(
  agent,
  refresh,
  interval,
  { once = false, isDone } = {},
) {
  const loop = createRefreshLoop({
    refresh,
    interval,
    isDone,
    isVisible: () => !document.hidden && navigator.onLine !== false,
    isConnected: () => !once && connected.has(agent),
  });
  const change = (event) => {
    if (!once && event.detail?.agent === agent) void loop.trigger();
  };
  const status = (event) => {
    if (event.detail?.agent === agent) loop.reschedule();
  };
  document.addEventListener("visibilitychange", loop.trigger);
  window.addEventListener("online", loop.trigger);
  window.addEventListener("offline", loop.reschedule);
  window.addEventListener("pocket-session-change", change);
  window.addEventListener("pocket-sync-status", status);
  return () => {
    loop.stop();
    document.removeEventListener("visibilitychange", loop.trigger);
    window.removeEventListener("online", loop.trigger);
    window.removeEventListener("offline", loop.reschedule);
    window.removeEventListener("pocket-session-change", change);
    window.removeEventListener("pocket-sync-status", status);
  };
}
