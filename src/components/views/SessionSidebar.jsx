import { SettingsDialog } from "../settings-dialog";
import { t } from "../../lib/i18n.js";
import { Navigation } from "../navigation";
import { IconButton, SessionStatus } from "../chat/controls";
import { PanelLeftClose, Plus, Search } from "lucide-react";
import { CompactSelect } from "@/components/ui/compact-select";
import { browserStorage as storage } from "../../lib/browser-storage";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { statuses } from "../../lib/session";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ConnectionDialog } from "../connection-dialog";
export function SessionSidebar({
  nav,
  desktopNav,
  setNav,
  setDesktopNav,
  agents,
  agent,
  busy,
  setSid,
  setDetail,
  setProject,
  setProjects,
  setSessions,
  setAgent,
  setDraft,
  pendingSend,
  projects,
  project,
  setError,
  visibleSessions,
  selectedAgent,
  selectSession,
  filter,
  setFilter,
  sessionHasMore,
  sessionLoading,
  sessionPagePending,
  sessionLimit,
  setSessionLimit,
  sid,
  loading,
  sessions,
  online,
  syncErrors,
}) {
  return (
    <Navigation open={nav} desktopOpen={desktopNav} onOpenChange={setNav}>
      <div className="brand">
        <img src="/brand/pokite-mark.svg" width="28" height="28" alt="" />
        <strong>Pokite</strong>
        <IconButton
          label={t("关闭导航")}
          onClick={() => {
            if (matchMedia("(max-width:760px)").matches) setNav(false);
            else setDesktopNav(false);
          }}
        >
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
          options={agents.map((a) => ({
            id: a.id,
            label: a.name,
          }))}
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
        {t("项目")}
        <CompactSelect
          label={t("项目")}
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
          {t("会话")}{" "}
          <Badge variant="secondary" className="session-count">
            {visibleSessions.length}
          </Badge>
        </span>
        <IconButton
          label={t("新建会话")}
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
          aria-label={t("搜索会话")}
          enterKeyHint="search"
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={t("搜索会话")}
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
            {t("正在加载会话…")}
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
              (s.unread ? t("，未读") : "")
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
              ? t("没有匹配的会话")
              : project?.emptyState ||
                selectedAgent?.emptyState ||
                t("暂无会话")}
          </p>
        )}
        {!sessions.length && loading && (
          <div className="session-skeleton">
            {Array.from(
              {
                length: 6,
              },
              (_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ),
            )}
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
        {online && !Object.keys(syncErrors).length
          ? t("已连接")
          : t("正在重连")}
        <ConnectionDialog />
        <SettingsDialog disabled={busy} />
      </footer>
    </Navigation>
  );
}
