import { takeInitialAccessToken, captureAccessToken } from "./lib/api";
import { useModelSettings } from "./hooks/use-model-settings";
import { ConversationView } from "./components/views/ConversationView";
import { t } from "./lib/i18n.js";
import { ChatComposer } from "./components/views/ChatComposer";
import { SessionSidebar } from "./components/views/SessionSidebar";
import { LoginScreen } from "./components/views/LoginScreen";
import { browserStorage as storage } from "./lib/browser-storage";
import { notificationRoute } from "./lib/notification-route";
import { useNotificationNavigation } from "./hooks/use-notification-navigation";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { PanelLeftOpen, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSessionSync, watchResource } from "./hooks/use-session-sync";
import { useComposerLayout } from "./hooks/use-composer-layout";
import { useVisualViewport } from "./hooks/use-visual-viewport";
import {
  api,
  getAccessToken,
  setAccessToken,
  persistAccessToken,
} from "./lib/api";
import { statuses, requestId } from "./lib/session";
import { IconButton } from "./components/chat/controls";
import {
  readDraft,
  writeDraft,
  restoreDraft,
  clearWithdrawnSubmission,
} from "./lib/drafts";
const agentOrder = [
  "codex",
  "codex2",
  "claudeDesktop",
  "claude",
  "dsh",
  "hermesDesktop",
  "penguin",
];
const compareAgents = (a, b) => {
  const rank = (id) =>
    agentOrder.includes(id) ? agentOrder.indexOf(id) : agentOrder.length;
  return rank(a.id) - rank(b.id);
};
export default function App() {
  const notificationTarget = useRef(
    notificationRoute(location.href, location.origin),
  );
  useVisualViewport();
  const [token, setToken] = useState(getAccessToken),
    [authed, setAuthed] = useState(false),
    [agents, setAgents] = useState([]),
    [agent, setAgent] = useState(
      notificationTarget.current?.agent || storage.getItem("agent") || "codex2",
    ),
    [projects, setProjects] = useState([]),
    [project, setProject] = useState(null),
    [sessions, setSessions] = useState([]),
    [sid, setSid] = useState(null),
    [detail, setDetail] = useState(null),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [online, setOnline] = useState(true),
    [nav, setNav] = useState(true),
    [desktopNav, setDesktopNav] = useState(true),
    [filter, setFilter] = useState(""),
    [older, setOlder] = useState(null),
    [historyBusy, setHistoryBusy] = useState(false),
    [showLatest, setShowLatest] = useState(false),
    [answers, setAnswers] = useState({});
  useSessionSync(authed && !!agent, agent);
  useNotificationNavigation({
    authed,
    busy,
    agent,
    projects,
    setAgent,
    setProject,
    selectSession,
    notificationTarget,
  });
  const [syncErrors, setSyncErrors] = useState({});
  const [storageUnavailable, setStorageUnavailable] = useState(() =>
    storage.hasUnsaved(),
  );
  useEffect(() => {
    const unsubscribe = storage.subscribe(setStorageUnavailable);
    const retry = () => {
      if (!document.hidden) storage.retry();
    };
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, []);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionLimit, setSessionLimit] = useState(40);
  const [sessionHasMore, setSessionHasMore] = useState(false);
  useEffect(() => {
    setSessionLimit(40);
    setSessionHasMore(false);
  }, [agent, project?.id, filter]);
  function syncFailed(scope, e) {
    if (!document.hidden)
      setSyncErrors((prev) => ({
        ...prev,
        [scope]: e.message,
      }));
  }
  function syncRecovered(scope) {
    setSyncErrors((prev) => {
      if (!(scope in prev)) return prev;
      const next = {
        ...prev,
      };
      delete next[scope];
      return next;
    });
  }
  const {
    modelCatalog,
    modelChoice,
    setModelChoice,
    modelError,
    setModelRefresh,
    effort,
    setEffort,
  } = useModelSettings({ agent, project, sid });
  const generation = useRef(0),
    active = useRef({
      agent,
      sid,
    }),
    scroller = useRef(null),
    historyRequest = useRef(null),
    autoHistoryCursor = useRef(null),
    historyAnchor = useRef(null),
    sessionPagePending = useRef(false),
    nearBottom = useRef(true),
    bottom = useRef(null),
    pendingSend = useRef(null);
  const textareaRef = useRef(null),
    draftRef = useRef(draft);
  draftRef.current = draft;
  useComposerLayout({
    textareaRef,
    scroller,
    nearBottom,
    draft,
    sid,
    projectId: project?.id,
  });
  active.current = {
    agent,
    sid,
  };
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
    setShowLatest(false);
  }, [agent, sid]);
  async function login(credential = token, retryInitial = true) {
    setAccessToken(credential.trim());
    try {
      const available = (await api("/agents")).sort(compareAgents);
      setAgents(available);
      if (!available.some((item) => item.id === agent))
        setAgent(available[0]?.id || "");
      persistAccessToken();
      takeInitialAccessToken();
      setAuthed(true);
      setError("");
    } catch (e) {
      const ticket =
        retryInitial && [401, 403].includes(e.status)
          ? takeInitialAccessToken()
          : null;
      if (ticket && ticket !== credential.trim()) return login(ticket, false);
      setError(e.message);
    }
  }
  useEffect(() => {
    if (getAccessToken()) login();
    // Opening another access link may reuse this tab as a same-document navigation.
    const pairedLink = () => {
      if (captureAccessToken()) void login(getAccessToken());
    };
    window.addEventListener("hashchange", pairedLink);
    return () => window.removeEventListener("hashchange", pairedLink);
  }, []);
  useEffect(() => {
    if (!authed) return;
    const refresh = async () => {
      try {
        const available = (await api("/agents")).sort(compareAgents);
        setAgents(available);
        if (!available.length) {
          setProjects([]);
          setProject(null);
          setSessions([]);
          setDetail(null);
          setSid(null);
        }
        setAgent((current) =>
          available.some((item) => item.id === current)
            ? current
            : available[0]?.id || "",
        );
      } catch {
        /* Existing sync indicators handle connection loss. */
      }
    };
    window.addEventListener("pokite:agents-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("pokite:agents-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [authed]);
  useEffect(() => {
    if (!authed || !agent) return;
    const gen = ++generation.current;
    setProjects([]);
    setProject(null);
    setSessions([]);
    setSid(null);
    setDetail(null);
    setError("");
    setSyncErrors({});
    setLoading(true);
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
            const target = notificationTarget.current;
            setSid(target.session);
            setDraft(readDraft("draft:" + agent + ":" + target.session) || "");
            setNav(false);
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
  function selectSession(id) {
    if (busy) return;
    setDraft(readDraft("draft:" + agent + ":" + (id || project?.id)) || "");
    setSid(id);
    setError("");
    setNav(false);
    pendingSend.current = null;
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
  function draftChange(v) {
    draftRef.current = v;
    setDraft(v);
    writeDraft("draft:" + agent + ":" + (sid || project?.id), v);
  }
  const queueActions = useRef(new Set());
  useEffect(() => {
    if (!sid || storageUnavailable) return;
    const pending = storage.getItem("withdraw:" + agent + ":" + sid);
    if (pending)
      void queueAction(
        {
          requestId: pending,
        },
        "withdraw",
      );
  }, [agent, sid, storageUnavailable]);
  async function queueAction(item, action) {
    const context = {
      agent,
      sid,
    };
    const identity = JSON.stringify([agent, sid, item.requestId, action]);
    if (queueActions.current.has(identity)) return;
    queueActions.current.add(identity);
    const pendingKey = "withdraw:" + agent + ":" + sid;
    try {
      if (
        action === "withdraw" &&
        storage.getItem(pendingKey) &&
        storage.getItem(pendingKey) !== item.requestId
      )
        throw Error(t("上一条撤回结果尚待恢复，请重新打开此会话后继续"));
      if (action === "withdraw")
        if (!storage.setItem(pendingKey, item.requestId))
          throw Error(
            t("无法保存撤回回执，消息尚未撤回；请恢复浏览器存储后重试"),
          );
      const result = await api(
        "/" +
          agent +
          "/sessions/" +
          encodeURIComponent(sid) +
          "/queue/" +
          encodeURIComponent(item.requestId) +
          "/" +
          action,
        {},
      );
      const same =
        active.current.agent === context.agent &&
        active.current.sid === context.sid;
      if (action === "withdraw") {
        const key = "draft:" + context.agent + ":" + context.sid;
        const restored = restoreDraft(storage, key, {
          ...result,
          receiptId: result.receiptId || item.requestId,
        });
        clearWithdrawnSubmission(
          storage,
          "pending-send:" + context.agent + ":" + context.sid,
          result.receiptId || item.requestId,
        );
        if (
          same &&
          pendingSend.current?.id === (result.receiptId || item.requestId)
        )
          pendingSend.current = null;
        if (same) {
          draftRef.current = restored.text;
          setDraft(restored.text);
          if (restored.applied && !restored.hadDraft && result.model) {
            setModelChoice(result.model.id || "");
            setEffort(result.model.effort || "");
          }
          textareaRef.current?.focus({
            preventScroll: true,
          });
        }
      }
      if (action === "withdraw" && !storage.hasUnsaved())
        storage.removeItem(pendingKey);
      if (same)
        setDetail((d) =>
          d
            ? {
                ...d,
                queue: d.queue.filter((x) => x.requestId !== item.requestId),
              }
            : d,
        );
    } catch (e) {
      if (e.status && e.status < 500) storage.removeItem(pendingKey);
      if (
        active.current.agent === context.agent &&
        active.current.sid === context.sid
      )
        setError(e.message);
    } finally {
      queueActions.current.delete(identity);
    }
  }
  async function send() {
    if (
      !draft.trim() ||
      busy ||
      !project ||
      agents.find((a) => a.id === agent)?.capabilities?.reply === false
    )
      return;
    const context = {
      agent,
      sid,
      projectId: project.id,
      text: draft,
      ...(effort
        ? {
            effort,
          }
        : {}),
      ...(modelChoice
        ? {
            modelId: modelChoice,
          }
        : {}),
    };
    setBusy(true);
    setError("");
    const signature = JSON.stringify(context);
    const pendingKey = "pending-send:" + agent + ":" + (sid || project.id);
    try {
      pendingSend.current = JSON.parse(storage.getItem(pendingKey));
    } catch {
      pendingSend.current = null;
    }
    if (pendingSend.current?.signature !== signature)
      pendingSend.current = {
        signature,
        id: requestId(),
      };
    try {
      if (
        !writeDraft("draft:" + agent + ":" + (sid || project.id), draft).saved
      )
        throw Error(t("草稿尚未保存，消息尚未发送；请恢复浏览器存储后重试"));
      if (!storage.setItem(pendingKey, JSON.stringify(pendingSend.current)))
        throw Error(
          t("本地存储不可用，无法保存发送回执；消息尚未发送，输入内容已保留"),
        );
      const result = await api(
        "/" +
          agent +
          "/sessions" +
          (sid ? "/" + encodeURIComponent(sid) + "/messages" : ""),
        {
          text: draft,
          ...(effort
            ? {
                effort,
              }
            : {}),
          projectId: project.id,
          requestId: pendingSend.current.id,
          ...(modelChoice
            ? {
                modelId: modelChoice,
              }
            : {}),
        },
      );
      if (active.current.agent !== context.agent) return;
      if (result.error) {
        setSid(result.id);
        setError(result.error);
        pendingSend.current = null;
        storage.removeItem(pendingKey);
        return;
      }
      const remaining =
        draftRef.current === context.text ? "" : draftRef.current;
      draftRef.current = remaining;
      setDraft(remaining);
      const cleared = writeDraft(
        "draft:" + context.agent + ":" + (context.sid || context.projectId),
        "",
      ).saved;
      if (remaining)
        writeDraft(
          "draft:" +
            context.agent +
            ":" +
            (result.id || context.sid || context.projectId),
          remaining,
        );
      setModelChoice("");
      setEffort("");
      setModelRefresh((x) => x + 1);
      pendingSend.current = null;
      if (cleared) storage.removeItem(pendingKey);
      if (result.id) setSid(result.id);
      else {
        const d = await api(
          "/" + agent + "/sessions/" + encodeURIComponent(sid),
        );
        setDetail(d);
      }
      nearBottom.current = true;
      setNav(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function answer(p, allow) {
    setBusy(true);
    try {
      await api(
        "/" +
          agent +
          "/sessions/" +
          encodeURIComponent(sid) +
          "/answers/" +
          encodeURIComponent(p.id),
        {
          allow,
          answers,
        },
      );
      setDetail(
        await api("/" + agent + "/sessions/" + encodeURIComponent(sid)),
      );
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!authed)
    return (
      <LoginScreen
        setToken={setToken}
        login={login}
        token={token}
        error={error}
        storageUnavailable={storageUnavailable}
      />
    );
  const selectedAgent = agents.find((a) => a.id === agent);
  const visibleSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="app">
      <SessionSidebar
        nav={nav}
        desktopNav={desktopNav}
        setNav={setNav}
        setDesktopNav={setDesktopNav}
        agents={agents}
        agent={agent}
        busy={busy}
        setSid={setSid}
        setDetail={setDetail}
        setProject={setProject}
        setProjects={setProjects}
        setSessions={setSessions}
        setAgent={setAgent}
        setDraft={setDraft}
        pendingSend={pendingSend}
        projects={projects}
        project={project}
        setError={setError}
        visibleSessions={visibleSessions}
        selectedAgent={selectedAgent}
        selectSession={selectSession}
        filter={filter}
        setFilter={setFilter}
        sessionHasMore={sessionHasMore}
        sessionLoading={sessionLoading}
        sessionPagePending={sessionPagePending}
        sessionLimit={sessionLimit}
        setSessionLimit={setSessionLimit}
        sid={sid}
        loading={loading}
        sessions={sessions}
        online={online}
        syncErrors={syncErrors}
      />
      <main className="main">
        <header>
          <IconButton
            label={t("项目与会话")}
            onClick={() => {
              if (matchMedia("(max-width:760px)").matches) setNav(true);
              else setDesktopNav(true);
            }}
          >
            <PanelLeftOpen size={20} />
          </IconButton>
          <div className="header-titles">
            <span>
              {selectedAgent?.name} <span className="separator">/</span>{" "}
              {project?.name || t("项目")}
            </span>
            <strong>
              {detail?.title || (sid ? t("加载中…") : t("新会话"))}
            </strong>
          </div>
          <Badge
            variant="secondary"
            className={"status " + (detail?.status || "idle")}
          >
            {detail ? statuses[detail.status] || detail.status : ""}
          </Badge>
        </header>
        {Object.keys(syncErrors).length > 0 && (
          <div className="sync-banner" role="status">
            <span>
              {Object.entries(syncErrors)
                .map(([scope, message]) => scope + "：" + message)
                .join("；")}{" "}
              {t("· 正在重试")}
            </span>
            <IconButton
              label={t("立即重试")}
              onClick={async () => {
                try {
                  if (selectedAgent?.capabilities?.connect)
                    await api("/" + agent + "/connect", {});
                  window.dispatchEvent(new Event("online"));
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <RefreshCw size={16} />
            </IconButton>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <IconButton label={t("关闭提示")} onClick={() => setError("")}>
              <X size={17} />
            </IconButton>
          </div>
        )}
        {storageUnavailable && (
          <div className="error-banner" role="status">
            <span>
              {t(
                "部分本地数据尚未保存。当前输入保留在本页，刷新或关闭页面可能丢失。",
              )}
            </span>
          </div>
        )}
        <ConversationView
          scroller={scroller}
          nearBottom={nearBottom}
          setShowLatest={setShowLatest}
          loadOlder={loadOlder}
          sid={sid}
          agents={agents}
          project={project}
          projects={projects}
          loading={loading}
          selectedAgent={selectedAgent}
          detail={detail}
          older={older}
          historyBusy={historyBusy}
          answers={answers}
          setAnswers={setAnswers}
          busy={busy}
          answer={answer}
          queueAction={queueAction}
          bottom={bottom}
        />
        <ChatComposer
          sid={sid}
          detail={detail}
          showLatest={showLatest}
          textareaRef={textareaRef}
          scroller={scroller}
          modelError={modelError}
          send={send}
          draft={draft}
          project={project}
          selectedAgent={selectedAgent}
          draftChange={draftChange}
          modelChoice={modelChoice}
          modelCatalog={modelCatalog}
          busy={busy}
          setModelChoice={setModelChoice}
          setEffort={setEffort}
          effort={effort}
        />
      </main>
    </div>
  );
}
