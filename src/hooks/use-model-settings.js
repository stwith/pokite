import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { browserStorage as storage } from "../lib/browser-storage.js";
import { readDraft } from "../lib/drafts.js";
import { watchResource } from "./use-session-sync";

export function useModelSettings({ agent, project, sid, modelRevision }) {
  const [effort, setEffort] = useState("");
  const [modelCatalog, setModelCatalog] = useState(null),
    [modelChoice, setModelChoice] = useState(""),
    [modelError, setModelError] = useState(""),
    [modelRefresh, setModelRefresh] = useState(0);
  useEffect(() => {
    let saved;
    try {
      const pending = JSON.parse(
        storage.getItem("pending-send:" + agent + ":" + (sid || project?.id)),
      );
      const context = JSON.parse(pending?.signature || "null");
      if (
        context?.text ===
        readDraft("draft:" + agent + ":" + (sid || project?.id))
      )
        saved = context;
    } catch {}
    setModelChoice(saved?.modelId || "");
    setEffort(saved?.effort || "");
    setModelError("");
    setModelCatalog(null);
  }, [agent, project?.id, sid]);
  useEffect(() => {
    if (!project) return;
    let alive = true;
    let working = false,
      loaded = false;
    function loadModels() {
      if (working || loaded || document.hidden) return;
      working = true;
      return api(
        "/" +
          agent +
          "/models?projectId=" +
          encodeURIComponent(project.id) +
          (sid ? "&sessionId=" + encodeURIComponent(sid) : ""),
      )
        .then((x) => {
          if (alive) {
            setModelCatalog(x);
            setModelError("");
            loaded = true;
          }
        })
        .catch((e) => {
          if (alive) {
            setModelCatalog(null);
            setModelError(e.message);
          }
        })
        .finally(() => {
          working = false;
        });
    }
    const stopRefresh = watchResource(agent, loadModels, 5000, {
      once: true,
      isDone: () => loaded,
    });
    return () => {
      alive = false;
      stopRefresh();
    };
  }, [agent, project?.id, sid, modelRefresh, modelRevision]);
  return {
    modelCatalog,
    modelChoice,
    setModelChoice,
    modelError,
    setModelRefresh,
    effort,
    setEffort,
  };
}
