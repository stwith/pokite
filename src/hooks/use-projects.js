import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { browserStorage as storage } from "../lib/browser-storage";
import { t } from "../lib/i18n.js";
import { watchResource } from "./use-session-sync";

// Loads the selected agent's projects. Switching agent clears the session
// state (onSwitch) and retries until one load succeeds, selecting the
// notification target's project, then the last used one, then the first.
// A pending notification target for this agent opens its session.
// The project state lives in App: notification navigation must read it and
// its effect must run before this one.
export function useProjects({
  authed,
  agent,
  notificationTarget,
  setProjects,
  setProject,
  onSwitch,
  openTarget,
  setLoading,
  setOnline,
  syncFailed,
  syncRecovered,
}) {
  const generation = useRef(0);
  useEffect(() => {
    if (!authed || !agent) return;
    const gen = ++generation.current;
    setProjects([]);
    setProject(null);
    onSwitch();
    storage.setItem("agent", agent);
    let working = false,
      loaded = false;
    function loadProjects() {
      if (working || loaded || document.hidden) return;
      working = true;
      return api("/" + agent + "/projects")
        .then((rows) => {
          if (gen !== generation.current) return;
          setProjects(rows);
          setProject(
            rows.find(
              (p) =>
                (p.id === notificationTarget.current?.project ||
                  p.aliases?.includes(notificationTarget.current?.project)) &&
                notificationTarget.current.agent === agent,
            ) ||
              rows.find(
                (p) =>
                  p.id === storage.getItem("project:" + agent) ||
                  p.aliases?.includes(storage.getItem("project:" + agent)),
              ) ||
              rows[0] ||
              null,
          );
          if (
            notificationTarget.current?.agent === agent &&
            rows.some(
              (p) =>
                p.id === notificationTarget.current.project ||
                p.aliases?.includes(notificationTarget.current.project),
            )
          ) {
            openTarget(notificationTarget.current);
            notificationTarget.current = null;
          }
          setOnline(true);
          loaded = true;
          syncRecovered(t("项目"));
        })
        .catch((e) => {
          if (gen === generation.current) {
            syncFailed(t("项目"), e);
            setOnline(false);
          }
        })
        .finally(() => {
          working = false;
          if (gen === generation.current) setLoading(false);
        });
    }
    const stopRefresh = watchResource(agent, loadProjects, 5000, {
      once: true,
      isDone: () => loaded,
    });
    return () => {
      ++generation.current;
      stopRefresh();
    };
  }, [agent, authed]);
}
