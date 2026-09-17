import { browserStorage as storage } from "./lib/browser-storage";
import { notificationRoute } from "./lib/notification-route";
import { clearNotifications } from "./lib/clear-notifications";
import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  Plus,
  Send,
  Folder,
  MessageSquare,
  RefreshCw,
  X,
  LoaderCircle,
  CircleAlert,
  Search,
  ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CompactSelect } from "@/components/ui/compact-select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import { MessageBubble } from "./components/chat/message-bubble";
import {
  IconButton,
  ComposerButton,
  SessionStatus,
} from "./components/chat/controls";
import {
  readDraft,
  writeDraft,
  restoreDraft,
  clearWithdrawnSubmission,
} from "./lib/drafts";
import { Navigation } from "./components/navigation";
import { ConnectionDialog } from "./components/connection-dialog";
import { NotificationSettings } from "./components/notification-settings";
import { DisconnectDialog } from "./components/disconnect-dialog";
import { HomeScreenGuide } from "./components/home-screen-guide";
import { PairingScanner } from "./components/pairing-scanner";
import { QueuedMessage } from "./components/chat/queued-message";

export default function App() {
  const notificationTarget = useRef(notificationRoute(location.href, location.origin));
  useVisualViewport();
  const [token, setToken] = useState(getAccessToken),
    [authed, setAuthed] = useState(false),
    [agents, setAgents] = useState([]),
    [agent, setAgent] = useState(notificationTarget.current?.agent || storage.getItem("agent") || "codex2"),
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
  useEffect(() => {
    if (!authed) return;
    const clear = () => { void clearNotifications(navigator, document); };
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
    const receive = event => {
      if (event.data?.type !== "pokite-open-session") return;
      if (authed) void clearNotifications(navigator, document);
      const target = notificationRoute(event.data.url, location.origin);
      if (!target) return;
      notificationTarget.current = target;
      history.replaceState(null, "", event.data.url);
      setNotificationRequest(target);
    };
    navigator.serviceWorker?.addEventListener("message", receive);
    return () => navigator.serviceWorker?.removeEventListener("message", receive);
  }, [agent, projects, busy, authed]);
  useEffect(() => {
    if (!notificationRequest || busy || !authed) return;
    if (notificationRequest.agent !== agent) { setAgent(notificationRequest.agent); return; }
    const next = projects.find(p => p.id === notificationRequest.project);
    if (next) {
      setProject(next); selectSession(notificationRequest.session);
      notificationTarget.current = null; setNotificationRequest(null);
    }
  }, [notificationRequest, busy, authed, agent, projects]);
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
  const [effort, setEffort] = useState("");
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionLimit, setSessionLimit] = useState(40);
  const [sessionHasMore, setSessionHasMore] = useState(false);
  useEffect(() => {
    setSessionLimit(40);
    setSessionHasMore(false);
  }, [agent, project?.id, filter]);
  function syncFailed(scope, e) {
    if (!document.hidden)
      setSyncErrors((prev) => ({ ...prev, [scope]: e.message }));
  }
  function syncRecovered(scope) {
    setSyncErrors((prev) => {
      if (!(scope in prev)) return prev;
      const next = { ...prev };
      delete next[scope];
      return next;
    });
  }
  const [modelCatalog, setModelCatalog] = useState(null),
    [modelChoice, setModelChoice] = useState(""),
    [modelError, setModelError] = useState(""),
    [modelRefresh, setModelRefresh] = useState(0);
  const generation = useRef(0),
    active = useRef({ agent, sid }),
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
  active.current = { agent, sid };
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
  }, [agent, project?.id, sid, modelRefresh]);
  async function login(credential = token) {
    setAccessToken(credential.trim());
    try {
      const order = ["codex", "codex2", "claude", "claudeDesktop", "dsh", "hermesDesktop", "penguin"];
      const rank = ({ id }) => {
        const index = order.indexOf(id);
        return index < 0 ? order.length : index;
      };
      const available = (await api("/agents")).sort((a, b) => rank(a) - rank(b));
      setAgents(available);
      if (!available.some((item) => item.id === agent))
        setAgent(available[0]?.id || "");
      persistAccessToken();
      setAuthed(true);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (getAccessToken()) login();
  }, []);
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
            rows.find((p) => p.id === notificationTarget.current?.project && notificationTarget.current.agent === agent) ||
            rows.find((p) => p.id === storage.getItem("project:" + agent)) ||
              rows[0] ||
              null,
          );
          if (notificationTarget.current?.agent === agent && rows.some(p => p.id === notificationTarget.current.project)) {
            const target = notificationTarget.current;
            setSid(target.session);
            setDraft(readDraft("draft:" + agent + ":" + target.session) || "");
            setNav(false);
            notificationTarget.current = null;
          }
          setOnline(true);
          loaded = true;
          syncRecovered("项目");
        })
        .catch((e) => {
          if (gen === generation.current) {
            syncFailed("项目", e);
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
    syncRecovered("会话列表");
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
          syncRecovered("会话列表");
        }
      } catch (e) {
        if (alive) {
          setOnline(false);
          syncFailed("会话列表", e);
        }
      } finally {
        working = false;
        if (alive) {
          sessionPagePending.current = false;
          setSessionLoading(false);
        }
      }
    }
    const stopRefresh = watchResource(agent, refresh, 5000, { once: false });
    return () => {
      alive = false;
      stopRefresh();
    };
  }, [agent, project?.id, sessionLimit, filter]);
  useEffect(() => {
    syncRecovered("会话内容");
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
          syncRecovered("会话内容");
          setSessions((rows) =>
            rows.map((s) =>
              s.id === sid ? { ...s, ...d, messages: undefined } : s,
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
                { revision: d.revision },
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
          syncFailed("会话内容", e);
        }
      } finally {
        working = false;
        if (alive) setLoading(false);
      }
    }
    const stopRefresh = watchResource(agent, refresh, 2500, { once: false });
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
    const context = { agent, sid };
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
      historyAnchor.current = { ...context, element, height, top };
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
          retryAt: Date.now() + Math.min(30000, 1000 * 2 ** Math.min(attempts - 1, 5)),
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
    if (
      el &&
      more &&
      !historyBusy &&
      el.scrollHeight <= el.clientHeight + 1
    ) {
      const retry = autoHistoryCursor.current;
      const delay = retry?.key === key ? Math.max(0, retry.retryAt - Date.now()) : 0;
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
    if (pending) void queueAction({ requestId: pending }, "withdraw");
  }, [agent, sid, storageUnavailable]);
  async function queueAction(item, action) {
    const context = { agent, sid };
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
        throw Error("上一条撤回结果尚待恢复，请重新打开此会话后继续");
      if (action === "withdraw")
        if (!storage.setItem(pendingKey, item.requestId))
          throw Error("无法保存撤回回执，消息尚未撤回；请恢复浏览器存储后重试");
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
          textareaRef.current?.focus({ preventScroll: true });
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
      ...(effort ? { effort } : {}),
      ...(modelChoice ? { modelId: modelChoice } : {}),
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
      pendingSend.current = { signature, id: requestId() };
    try {
      if (
        !writeDraft("draft:" + agent + ":" + (sid || project.id), draft).saved
      )
        throw Error("草稿尚未保存，消息尚未发送；请恢复浏览器存储后重试");
      if (!storage.setItem(pendingKey, JSON.stringify(pendingSend.current)))
        throw Error(
          "本地存储不可用，无法保存发送回执；消息尚未发送，输入内容已保留",
        );
      const result = await api(
        "/" +
          agent +
          "/sessions" +
          (sid ? "/" + encodeURIComponent(sid) + "/messages" : ""),
        {
          text: draft,
          ...(effort ? { effort } : {}),
          projectId: project.id,
          requestId: pendingSend.current.id,
          ...(modelChoice ? { modelId: modelChoice } : {}),
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
        { allow, answers },
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
      <main className="login">
        <div className="login-brand">
          <img src="/brand/pokite-mark.svg" width="48" height="48" alt="" />
          <h1>Pokite <span>口袋风筝</span></h1>
        </div>
        <div className="login-heading"><h2>连接你的电脑</h2><p>继续电脑上正在运行的会话。</p></div>
        <PairingScanner onConnect={async (value) => { setToken(value); await login(value); }} />
        <div className="login-divider"><span>或使用访问码</span></div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
        >
          <label htmlFor="token">访问码</label>
          <Input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="current-password"
            placeholder="粘贴访问码"
            autoCapitalize="none"
            spellCheck={false}
          />
          <Button type="submit">连接</Button>
        </form>
        <details className="login-help"><summary>在哪里获取连接信息？</summary><p>在电脑上的 Pokite 打开侧栏底部的二维码按钮，查看二维码和访问码。手机与电脑需在同一局域网或 Tailscale 网络。</p></details>
        <HomeScreenGuide />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {storageUnavailable && (
          <div className="error-banner" role="status">
            <span>
              部分本地数据尚未保存。当前输入保留在本页，刷新或关闭页面可能丢失。
            </span>
          </div>
        )}
      </main>
    );
  const selectedAgent = agents.find((a) => a.id === agent);
  const visibleSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="app">
      <Navigation open={nav} desktopOpen={desktopNav} onOpenChange={setNav}>
        <div className="brand">
          <img src="/brand/pokite-mark.svg" width="28" height="28" alt="" />
          <strong>Pokite</strong>
          <IconButton label="关闭导航" onClick={() => {
            if (matchMedia("(max-width:760px)").matches) setNav(false);
            else setDesktopNav(false);
          }}>
            <PanelLeftClose size={18} />
          </IconButton>
        </div>
        <label className="select-label">
          Agent
          <CompactSelect
            label="Agent"
            className="sidebar-select"
            defaultOption={false}
            side="bottom"
            options={agents.map((a) => ({ id: a.id, label: a.name }))}
            value={agent}
            disabled={busy || !agents.length}
            onChange={(value) => {
              if (value === agent) return;
              setSid(null);
              setDetail(null);
              setProject(null);
              setProjects([]);
              setSessions([]);
              setAgent(value);
              setDraft("");
              pendingSend.current = null;
            }}
          />
        </label>
        <label className="select-label">
          项目
          <CompactSelect
            label="项目"
            className="sidebar-select"
            defaultOption={false}
            side="bottom"
            options={projects.map((p) => ({
              id: p.id,
              label: p.name,
            }))}
            value={project?.id || ""}
            disabled={busy || !projects.length}
            onChange={(value) => {
              if (value === project?.id) return;
              setSid(null);
              setDetail(null);
              setSessions([]);
              setProject(projects.find((p) => p.id === value));
              storage.setItem("project:" + agent, value);
              setDraft("");
              setError("");
            }}
          />
        </label>
        <div className="session-heading">
          <span>
            会话{" "}
            <Badge variant="secondary" className="session-count">
              {visibleSessions.length}
            </Badge>
          </span>
          <IconButton
            label="新建会话"
            disabled={
              !project ||
              project.canCreate === false ||
              selectedAgent?.capabilities?.create === false ||
              busy
            }
            onClick={() => selectSession(null)}
          >
            <Plus size={20} />
          </IconButton>
        </div>
        <div className="search-wrap">
          <Search size={15} aria-hidden="true" />
          <Input
            className="search"
            aria-label="搜索会话"
            enterKeyHint="search"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="搜索会话"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <nav
          onScroll={(e) => {
            const el = e.currentTarget;
            if (
              sessionHasMore &&
              !sessionLoading &&
              !sessionPagePending.current &&
              sessionLimit < 10000 &&
              el.scrollHeight - el.scrollTop - el.clientHeight < 160
            ) {
              sessionPagePending.current = true;
              setSessionLimit((n) => Math.min(10000, n + 40));
            }
          }}
        >
          {sessionLoading && (
            <div role="status" className="session-loading">
              正在加载会话…
            </div>
          )}
          {visibleSessions.map((s) => (
            <Button
              key={s.id}
              variant="ghost"
              data-session-id={s.id}
              className={"session " + (s.id === sid ? "selected" : "")}
              aria-current={s.id === sid ? "page" : undefined}
              aria-label={
                s.title +
                "，" +
                (statuses[s.status] || s.status) +
                (s.unread ? "，未读" : "")
              }
              disabled={busy}
              onClick={() => selectSession(s.id)}
            >
              <span className="session-title">
                <span>{s.title}</span>
              </span>
              <SessionStatus status={s.status} unread={s.unread} />
            </Button>
          ))}
          {!visibleSessions.length && !loading && !sessionLoading && (
            <p className="muted empty-list">
              {filter
                ? "没有匹配的会话"
                : project?.emptyState ||
                  selectedAgent?.emptyState ||
                  "暂无会话"}
            </p>
          )}
          {!sessions.length && loading && (
            <div className="session-skeleton">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          )}
        </nav>
        <Separator />
        <footer>
          <span
            className={
              "connection " +
              (online && !Object.keys(syncErrors).length ? "" : "offline")
            }
          />
          {online && !Object.keys(syncErrors).length ? "已连接" : "正在重连"}
          <span className="host">Mac mini</span>
          <ConnectionDialog />
          <NotificationSettings />
          <DisconnectDialog disabled={busy} />
        </footer>
      </Navigation>
      <main className="main">
        <header>
          <IconButton label="项目与会话" onClick={() => {
            if (matchMedia("(max-width:760px)").matches) setNav(true);
            else setDesktopNav(true);
          }}>
            <PanelLeftOpen size={20} />
          </IconButton>
          <div className="header-titles">
            <span>
              {selectedAgent?.name} <span className="separator">/</span>{" "}
              {project?.name || "项目"}
            </span>
            <strong>{detail?.title || (sid ? "加载中…" : "新会话")}</strong>
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
              · 正在重试
            </span>
            <IconButton
              label="立即重试"
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
            <IconButton label="关闭提示" onClick={() => setError("")}>
              <X size={17} />
            </IconButton>
          </div>
        )}
        {storageUnavailable && (
          <div className="error-banner" role="status">
            <span>
              部分本地数据尚未保存。当前输入保留在本页，刷新或关闭页面可能丢失。
            </span>
          </div>
        )}
        <section
          className="conversation"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            setShowLatest(
              el.scrollHeight - el.scrollTop - el.clientHeight >
                Math.max(240, el.clientHeight / 2),
            );
            if (el.scrollTop < 120 && !nearBottom.current) void loadOlder();
          }}
        >
          {!sid ? (
            <div className="new-session">
              <MessageSquare size={32} />
              <h1>{agents.length ? "新会话" : "未发现可接入的本机会话"}</h1>
              <p>
                <Folder size={16} />
                {project?.name ||
                  (!projects.length && !loading && selectedAgent?.emptyState) ||
                  "选择已有项目"}
              </p>
            </div>
          ) : loading && !detail ? (
            <div className="chat-skeleton" role="status" aria-label="加载会话">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <div className="messages">
              {(older ? older.hasMore : detail?.hasMore) && (
                <div className="history-button" role="status">
                  {historyBusy ? "加载中…" : ""}
                </div>
              )}
              {[
                ...new Map(
                  [...(older?.messages || []), ...(detail?.messages || [])].map(
                    (m) => [m.id, m],
                  ),
                ).values(),
              ].map((m) => (
                <MessageBubble
                  key={m.id}
                  role={m.role}
                  text={m.text}
                  time={m.time}
                />
              ))}
              {detail?.pending?.map((p) => (
                <section className="approval" key={p.id}>
                  <strong>
                    {p.kind === "question" ? "需要你的回复" : "等待审批"}
                  </strong>
                  {p.kind === "question" ? (
                    p.questions?.map((q) => (
                      <label key={q.id}>
                        {q.question}
                        <Input
                          value={answers[q.id] || ""}
                          onChange={(e) =>
                            setAnswers({ ...answers, [q.id]: e.target.value })
                          }
                        />
                        {q.options?.map((o) => (
                          <Button
                            variant="outline"
                            size="sm"
                            key={o.label}
                            onClick={() =>
                              setAnswers({ ...answers, [q.id]: o.label })
                            }
                          >
                            {o.label}
                          </Button>
                        ))}
                      </label>
                    ))
                  ) : (
                    <>
                      <pre>{p.title}</pre>
                      <p>{p.detail}</p>
                    </>
                  )}
                  <div className="approval-actions">
                    {p.kind === "approval" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => answer(p, false)}
                      >
                        <X size={15} />
                        拒绝
                      </Button>
                    )}
                    <Button disabled={busy} onClick={() => answer(p, true)}>
                      <Check size={15} />
                      {p.kind === "question" ? "提交" : "允许本次"}
                    </Button>
                  </div>
                </section>
              ))}
              {detail?.executionIssue && (
                <div className="execution-issue" role={detail.executionIssue.retrying ? "status" : "alert"}>
                  <CircleAlert size={17} aria-hidden="true" />
                  <div><strong>{detail.executionIssue.retrying ? "上游连接异常，Agent 正在自动重试" : "本轮执行失败"}</strong>
                    <p>{detail.executionIssue.message}</p>
                  </div>
                </div>
              )}
              {detail?.status === "running" && !detail.executionIssue && (
                <p className="working">
                  <span />
                  {detail.executionProgress || "运行中"}
                </p>
              )}
              {detail?.liveExternal && <p className="muted">电脑端正在执行</p>}
              {detail?.offline && (
                <p className="muted" role="status">
                  电脑端连接尚未就绪，排队消息将在连接恢复后处理。
                </p>
              )}
              {detail?.queue?.map((q) => (
                <QueuedMessage
                  key={q.requestId}
                  item={q}
                  canEdit={!busy}
                  onAction={queueAction}
                />
              ))}
              {detail?.status === "waiting" && !detail.pending?.length && (
                <p className="muted">请在原 Agent 界面处理当前审批。</p>
              )}
              <div ref={bottom} />
            </div>
          )}
        </section>
        <div className="composer-wrap">
          {sid && detail && showLatest && (
            <ComposerButton
              inputRef={textareaRef}
              variant="outline"
              size="icon"
              className="jump-to-latest"
              aria-label="回到最新消息"
              onPress={() => {
                const el = scroller.current;
                if (!el) return;
                el.scrollTo({
                  top: el.scrollHeight,
                  behavior: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? "instant"
                    : "smooth",
                });
              }}
            >
              <ArrowDown size={19} aria-hidden="true" />
            </ComposerButton>
          )}
          {detail?.readOnlyReason && (
            <p className="model-error">{detail.readOnlyReason}</p>
          )}
          {modelError && (
            <p className="model-error" role="status">
              模型列表暂不可用 · {modelError}
            </p>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Textarea
              ref={textareaRef}
              aria-label="消息"
              placeholder={sid ? "回复…" : "描述你想完成的任务…"}
              value={draft}
              disabled={
                !project ||
                selectedAgent?.capabilities?.reply === false ||
                detail?.readOnly ||
                (!sid && project.canCreate === false)
              }
              onChange={(e) => draftChange(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.nativeEvent.keyCode !== 229
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="composer-bottom">
              <div className="composer-actions">
                <div className="model-picker">
                  <CompactSelect
                    label="模型"
                    value={modelChoice || modelCatalog?.current || ""}
                    defaultOption={
                      !modelCatalog?.options.some(
                        (m) => m.id === (modelChoice || modelCatalog.current),
                      )
                    }
                    disabled={busy || !modelCatalog?.canSwitch}
                    onChange={(value) => {
                      setModelChoice(value);
                      setEffort("");
                    }}
                    placeholder={
                      modelCatalog?.options.find(
                        (m) => m.id === modelCatalog.current,
                      )?.label ||
                      detail?.model ||
                      "默认模型"
                    }
                    options={modelCatalog?.options || []}
                  />
                </div>
                {!!modelCatalog?.options.find(
                  (m) => m.id === (modelChoice || modelCatalog.current),
                )?.efforts?.length && (
                  <div className="effort-picker">
                    <CompactSelect
                      label="推理强度"
                      value={effort || modelCatalog.currentEffort || ""}
                      defaultOption={
                        !modelCatalog.options
                          .find(
                            (m) =>
                              m.id === (modelChoice || modelCatalog.current),
                          )
                          ?.efforts.includes(
                            effort || modelCatalog.currentEffort,
                          )
                      }
                      onChange={setEffort}
                      placeholder={modelCatalog.currentEffort || "默认强度"}
                      options={modelCatalog.options
                        .find(
                          (m) => m.id === (modelChoice || modelCatalog.current),
                        )
                        .efforts.map((e) => ({ id: e, label: e }))}
                    />
                  </div>
                )}
                <ComposerButton
                  inputRef={textareaRef}
                  onPress={send}
                  size="icon"
                  className="send"
                  aria-label="发送"
                  aria-busy={busy}
                  disabled={
                    busy ||
                    selectedAgent?.capabilities?.reply === false ||
                    !draft.trim() ||
                    !project ||
                    (sid && (!detail || detail.readOnly))
                  }
                >
                  {busy ? (
                    <LoaderCircle size={17} strokeWidth={2} className="spin" />
                  ) : (
                    <Send size={17} strokeWidth={2} />
                  )}
                </ComposerButton>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
