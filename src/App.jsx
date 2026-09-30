import { useModelSettings } from "./hooks/use-model-settings";
import { ConversationView } from "./components/views/ConversationView";
import { ChatComposer } from "./components/views/ChatComposer";
import { SessionSidebar } from "./components/views/SessionSidebar";
import { LoginScreen } from "./components/views/LoginScreen";
import { MainHeader } from "./components/views/MainHeader";
import { browserStorage as storage } from "./lib/browser-storage";
import { notificationRoute } from "./lib/notification-route";
import { useNotificationNavigation } from "./hooks/use-notification-navigation";
import { useState, useEffect, useRef } from "react";
import { useSessionSync } from "./hooks/use-session-sync";
import { useComposerLayout } from "./hooks/use-composer-layout";
import { useVisualViewport } from "./hooks/use-visual-viewport";
import { useStorageStatus } from "./hooks/use-storage-status";
import { useSyncErrors } from "./hooks/use-sync-errors";
import { useAuth } from "./hooks/use-auth";
import { useAgents } from "./hooks/use-agents";
import { useProjects } from "./hooks/use-projects";
import { useSessionList } from "./hooks/use-session-list";
import { useSessionDetail } from "./hooks/use-session-detail";
import { useMessageActions } from "./hooks/use-message-actions";
import { readDraft, writeDraft } from "./lib/drafts";

export default function App() {
  const notificationTarget = useRef(
    notificationRoute(location.href, location.origin),
  );
  useVisualViewport();
  const [sid, setSid] = useState(null),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [online, setOnline] = useState(true),
    [nav, setNav] = useState(true),
    [desktopNav, setDesktopNav] = useState(true),
    [filter, setFilter] = useState(""),
    [showLatest, setShowLatest] = useState(false),
    [answers, setAnswers] = useState({}),
    [projects, setProjects] = useState([]),
    [project, setProject] = useState(null);
  // Clears everything below the agent level (agent list emptied or signed out).
  // The callbacks below reference setters of hooks declared further down;
  // they only run after render, when those bindings exist.
  const clearAgentState = () => {
    setProjects([]);
    setProject(null);
    setSessions([]);
    setSid(null);
    setDetail(null);
  };
  const { token, setToken, authed, login } = useAuth({
    applyAgents: (available) => applyAgents(available),
    setError,
    onExpired: () => {
      setAgents([]);
      clearAgentState();
    },
  });
  const { agents, setAgents, agent, setAgent, applyAgents } = useAgents({
    authed,
    initialAgent:
      notificationTarget.current?.agent || storage.getItem("agent") || "codex2",
    onEmpty: clearAgentState,
  });
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
  const storageUnavailable = useStorageStatus();
  const { syncErrors, setSyncErrors, syncFailed, syncRecovered } =
    useSyncErrors();
  const active = useRef({ agent, sid }),
    scroller = useRef(null),
    nearBottom = useRef(true),
    bottom = useRef(null),
    pendingSend = useRef(null),
    textareaRef = useRef(null),
    draftRef = useRef(draft);
  draftRef.current = draft;
  active.current = { agent, sid };
  useComposerLayout({
    textareaRef,
    scroller,
    nearBottom,
    draft,
    sid,
    projectId: project?.id,
  });
  useProjects({
    authed,
    agent,
    notificationTarget,
    setProjects,
    setProject,
    onSwitch: () => {
      setSessions([]);
      setSid(null);
      setDetail(null);
      setError("");
      setSyncErrors({});
      setLoading(true);
    },
    openTarget: (target) => {
      setSid(target.session);
      setDraft(readDraft("draft:" + agent + ":" + target.session) || "");
      setNav(false);
    },
    setLoading,
    setOnline,
    syncFailed,
    syncRecovered,
  });
  const {
    sessions,
    setSessions,
    sessionLoading,
    sessionLimit,
    setSessionLimit,
    sessionHasMore,
    sessionPagePending,
  } = useSessionList({
    agent,
    project,
    filter,
    setOnline,
    syncFailed,
    syncRecovered,
  });
  const { detail, setDetail, older, historyBusy, loadOlder } = useSessionDetail(
    {
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
    },
  );
  const {
    modelCatalog,
    modelChoice,
    setModelChoice,
    modelError,
    setModelRefresh,
    effort,
    setEffort,
  } = useModelSettings({
    agent,
    project,
    sid,
    modelRevision:
      detail?.id === sid ? `${detail.model || ""}:${detail.effort || ""}` : "",
  });
  useEffect(() => {
    setShowLatest(false);
  }, [agent, sid]);
  const { send, answer, queueAction } = useMessageActions({
    agent,
    sid,
    setSid,
    project,
    agents,
    active,
    draft,
    draftRef,
    setDraft,
    textareaRef,
    pendingSend,
    busy,
    setBusy,
    setError,
    setDetail,
    setNav,
    nearBottom,
    answers,
    effort,
    setEffort,
    modelChoice,
    setModelChoice,
    setModelRefresh,
    storageUnavailable,
  });
  function selectSession(id) {
    if (busy) return;
    setDraft(readDraft("draft:" + agent + ":" + (id || project?.id)) || "");
    setSid(id);
    setError("");
    setNav(false);
    pendingSend.current = null;
  }
  function draftChange(v) {
    draftRef.current = v;
    setDraft(v);
    writeDraft("draft:" + agent + ":" + (sid || project?.id), v);
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
        <MainHeader
          agent={agent}
          selectedAgent={selectedAgent}
          project={project}
          sid={sid}
          detail={detail}
          syncErrors={syncErrors}
          error={error}
          setError={setError}
          storageUnavailable={storageUnavailable}
          setNav={setNav}
          setDesktopNav={setDesktopNav}
        />
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
