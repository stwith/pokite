import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { clearNotifications } from "../lib/clear-notifications";
import { notificationRoute } from "../lib/notification-route";

export function useNotificationNavigation({
  authed,
  busy,
  agent,
  projects,
  setAgent,
  setProject,
  selectSession,
  notificationTarget,
}) {
  useEffect(() => {
    if (!authed || !navigator.serviceWorker) return;
    void navigator.serviceWorker
      .getRegistration("/")
      .then(async (registration) => {
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription)
          await api("/notifications/status", {
            endpoint: subscription.endpoint,
          });
      })
      .catch(() => {});
  }, [authed]);
  useEffect(() => {
    if (!authed) return;
    const clear = () => {
      void clearNotifications(navigator, document);
    };
    clear();
    document.addEventListener("visibilitychange", clear);
    window.addEventListener("pageshow", clear);
    window.addEventListener("focus", clear);
    return () => {
      document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("pageshow", clear);
      window.removeEventListener("focus", clear);
    };
  }, [authed]);
  const [notificationRequest, setNotificationRequest] = useState(null);
  useEffect(() => {
    const receive = (event) => {
      if (event.data?.type !== "pokite-open-session") return;
      if (authed) void clearNotifications(navigator, document);
      const target = notificationRoute(event.data.url, location.origin);
      if (!target) return;
      notificationTarget.current = target;
      history.replaceState(null, "", event.data.url);
      setNotificationRequest(target);
    };
    navigator.serviceWorker?.addEventListener("message", receive);
    return () =>
      navigator.serviceWorker?.removeEventListener("message", receive);
  }, [agent, projects, busy, authed]);
  useEffect(() => {
    if (!notificationRequest || busy || !authed) return;
    if (notificationRequest.agent !== agent) {
      setAgent(notificationRequest.agent);
      return;
    }
    const next = projects.find((p) => p.id === notificationRequest.project);
    if (next) {
      setProject(next);
      selectSession(notificationRequest.session);
      notificationTarget.current = null;
      setNotificationRequest(null);
    }
  }, [notificationRequest, busy, authed, agent, projects]);
}
