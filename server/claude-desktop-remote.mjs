import fs from "node:fs/promises";
import path from "node:path";
import { ClaudeDesktop } from "./claude-desktop.mjs";
import { ClaudeDesktopClient } from "./claude-desktop-client.mjs";
import { canonicalDesktopSessionId } from "./claude-desktop-credentials.mjs";
import {
  remoteMessages,
  remoteSessionStatus,
  userEvent,
  nativeRequestId,
} from "./claude-desktop-events.mjs";
import { WeightedCache } from "./weighted-cache.mjs";

export class ClaudeDesktopRemote extends ClaudeDesktop {
  constructor(root, options = {}) {
    super(root, options);
    this.now = options.now || Date.now;
    this.client = options.client || new ClaudeDesktopClient(this.root);
    this.readOnly = false;
    this.supportsVirtualProjects = true;
    this.pages = new WeightedCache({
      maxEntries: 30,
      maxWeight: 16 * 1024 * 1024,
      weigh: (p) =>
        512 + p.messages.reduce((n, m) => n + 128 + m.text.length * 2, 0),
    });
    this.metadata = new WeightedCache({
      maxEntries: 200,
      maxWeight: 2 * 1024 * 1024,
      weigh: () => 10240,
    });
    this.metadataPending = new Map();
    this.emptyState = "当前账号暂无可读取的 Cowork 会话。";
  }
  async connect() {
    return this.client.connect();
  }
  receiptId(requestId) {
    return nativeRequestId(requestId);
  }
  async sessions(projectId, options = {}) {
    return (await this.raw({ projectId, limit: options.limit || 40 }))
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(
        ({
          scope,
          remoteId,
          audit,
          cliSessionId,
          codeLocalId,
          codeBridgeIds,
          codeSpawnBridgeId,
          codeRemoteEnabled,
          ...s
        }) => s,
      );
  }
  subscribeChanges(notify) {
    const timer = setInterval(notify, 3000);
    timer.unref?.();
    return () => clearInterval(timer);
  }
  async cachedMetadata(key, load, { stale = false, fresh = false } = {}) {
    const cached = this.metadata.get(key);
    if (!fresh && cached && this.now() - cached.time < 2500) return cached.row;
    let work = this.metadataPending.get(key);
    if (!work) {
      work = Promise.resolve()
        .then(load)
        .then((row) => {
          this.metadata.set(key, { row, time: this.now() });
          if (cached && JSON.stringify(cached.row) !== JSON.stringify(row))
            this.onChange?.();
          return row;
        })
        .finally(() => this.metadataPending.delete(key));
      this.metadataPending.set(key, work);
    }
    if (stale && !fresh && cached && this.now() - cached.time < 30000) {
      void work.catch(() => {});
      return cached.row;
    }
    return work;
  }
  async raw(selection = {}) {
    const local = (await super.raw()).filter(s => !s.codeLocalId);
    const { account, organization } = this.cache;
    if (!organization) return local;
    const scope = account + ":" + organization;
    if (
      selection.id?.startsWith("code:") ||
      selection.projectId?.startsWith("claude-code-sessions:")
    )
      return [];
    const file = path.join(
      this.root,
      "local-agent-mode-sessions",
      account,
      organization,
      "remote-session-spaces.json",
    );
    const refs = await fs
      .readFile(file, "utf8")
      .then(JSON.parse)
      .catch(() => null);
    const projects = this.cache.projects || [];
    const entries = (Array.isArray(refs?.entries) ? refs.entries : []).filter(
      (e) =>
        canonicalDesktopSessionId(e?.sessionId) &&
        typeof e.spaceId === "string" &&
        (!selection.id ||
          selection.id ===
            [
              "remote",
              account,
              organization,
              canonicalDesktopSessionId(e.sessionId),
            ].join(":")) &&
        (!selection.projectId ||
          selection.projectId ===
            ["local-agent-mode-sessions", account, organization, e.spaceId]
              .map(encodeURIComponent)
              .join(":")),
    );
    const rows = [];
    // Bound metadata concurrency; project discovery never downloads transcripts.
    for (let offset = 0; offset < entries.length; offset += 3) {
      const batch = await Promise.all(
        entries.slice(offset, offset + 3).map(async (entry) => {
          const remoteId = canonicalDesktopSessionId(entry.sessionId);
          const projectId = [
            "local-agent-mode-sessions",
            account,
            organization,
            entry.spaceId,
          ]
            .map(encodeURIComponent)
            .join(":");
          const project = projects.find((p) => p.id === projectId);
          if (!project) return null;
          return this.cachedMetadata(
            [scope, remoteId, projectId, project.name].join(":"),
            async () => {
              const response = await this.client.request(
                "/v1/code/sessions/" + remoteId,
                { scope },
              );
              const s = response.session || response.response_shape;
              if (canonicalDesktopSessionId(s?.id) !== remoteId)
                throw Error("Claude 会话身份不一致。");
              return {
                id: ["remote", account, organization, remoteId].join(":"),
                remoteId,
                scope,
                projectId,
                projectName: project.name,
                workspace: project.path,
                title: s.title || "未命名会话",
                status: remoteSessionStatus(s),
                updatedAt: Date.parse(s.updated_at || s.created_at) || 0,
                revision: [
                  s.last_event_at,
                  s.updated_at,
                  s.worker_status,
                  s.status,
                ].join(":"),
                nativeUnread:
                  typeof s.unread === "boolean" ? s.unread : undefined,
                model: s.config?.model,
                readOnly: s.status === "archived",
                canReply: s.status !== "archived",
                readOnlyReason:
                  s.status === "archived"
                    ? "此会话已在 Claude 归档。"
                    : undefined,
                offline:
                  s.environment_kind === "bridge" &&
                  s.connection_status !== "connected",
                pending: [],
              };
            },
            { stale: !!selection.projectId, fresh: selection.fresh === true },
          );
        }),
      );
      rows.push(...batch.filter(Boolean));
    }
    const current = await this.client.identity();
    if (current.account + ":" + current.organization !== scope)
      throw Error("Claude 账号已切换，请刷新。");
    return [...local, ...rows];
  }
  async projects() {
    // Read local project definitions first so an expired login cannot hide names.
    await super.raw();
    return [
      ...new Map(
        [
          ...this.cache.rows.filter(s => !s.codeLocalId).map((s) => ({
            id: s.projectId,
            name:
              !s.projectName.startsWith("Cowork · ")
                  ? "Cowork · " + s.projectName
                  : s.projectName,
            path: s.workspace || "",
            canCreate: false,
            readOnly: true,
            virtual: true,
          })),
          ...(this.cache.projects || []).map((p) => ({
            ...p,
            name: p.name.startsWith("Cowork · ")
              ? p.name
              : "Cowork · " + p.name,
            virtual: true,
            emptyState: "此项目暂无已关联的 Cowork 会话。",
          })),
        ].map((p) => [p.id, p]),
      ).values(),
    ];
  }
  async page(row, cursor) {
    if (
      cursor !== undefined &&
      (typeof cursor !== "string" || !/^[a-zA-Z0-9_:-]{1,180}$/.test(cursor))
    )
      throw Error("Invalid history cursor");
    const key =
      row.id +
      ":" +
      row.remoteId +
      ":" +
      row.revision +
      ":" +
      (cursor || "latest");
    const cached = this.pages.get(key);
    if (cached) return cached;
    const events = [];
    const seen = new Set();
    let next = cursor;
    let parsed = { messages: [], acceptedRequestIds: [] };
    for (let page = 0; page < 10; page++) {
      const response = await this.client.request(
        "/v1/code/sessions/" +
          row.remoteId +
          "/events?limit=100" +
          (next ? "&cursor=" + encodeURIComponent(next) : ""),
        { scope: row.scope },
      );
      if (!Array.isArray(response.data)) throw Error("Claude 历史格式不兼容。");
      events.push(...response.data);
      const returned = response.next_cursor;
      if (returned != null && typeof returned !== "string")
        throw Error("Claude 历史游标格式不兼容。");
      next = returned || undefined;
      if (next && seen.has(next)) throw Error("Claude 历史游标未推进。");
      if (next) seen.add(next);
      parsed = remoteMessages(events);
      if (parsed.messages.length > 0 || !next) break;
    }
    const result = { ...parsed, hasMore: !!next, historyCursor: next };
    this.pages.set(key, result);
    return result;
  }
  async detail(id) {
    const row = (await this.raw({ id })).find((s) => s.id === id);
    if (!row)
      throw Object.assign(Error("Claude 会话不存在或账号已切换。"), {
        status: 404,
      });
    if (!row.remoteId) {
      const local = (await super.loadDetail(id, [row])).result;
      const {
        codeLocalId,
        codeBridgeIds,
        codeSpawnBridgeId,
        codeRemoteEnabled,
        ...visible
      } = local;
      return {
        ...visible,
        readOnlyReason: row.readOnlyReason || local.readOnlyReason,
      };
    }
    const {
      scope,
      remoteId,
      codeLocalId,
      codeBridgeIds,
      codeSpawnBridgeId,
      codeRemoteEnabled,
      audit,
      cliSessionId,
      ...visible
    } = row;
    return { ...visible, ...(await this.page(row)), executionIssue: row.status === "failed"
      ? { retrying: false, message: "Cowork 执行失败，请检查原会话；当前接口未提供具体错误原因。" } : null };
  }
  async history(id, cursor) {
    const row = (await this.raw({ id })).find((s) => s.id === id);
    if (!row?.remoteId)
      return super.history(id, cursor, row ? [row] : undefined);
    return this.page(row, cursor);
  }
  async send(id, text, requestId) {
    let row;
    try {
      row = (await this.raw({ id, fresh: true })).find((s) => s.id === id);
    } catch (error) {
      error.delivery = "not-sent";
      throw error;
    }
    if (!row?.remoteId || row.readOnly)
      throw Object.assign(Error("此 Claude 会话不可回复。"), {
        delivery: "not-sent",
      });
    if (
      !["idle", "completed", "failed", "interrupted"].includes(row.status) ||
      row.offline
    )
      throw Object.assign(Error("等待 Claude 原会话恢复。"), {
        delivery: "not-sent",
      });
    // The controller sends an event; it never registers or replaces a worker.
    const receipt = await this.client.request(
      "/v1/code/sessions/" + row.remoteId + "/events",
      {
        method: "POST",
        scope: row.scope,
        body: userEvent(row.remoteId, requestId, text),
      },
    );
    this.pages.clear();
    this.metadata.clear();
    this.onChange?.();
    return { accepted: true, requestId, receiptAvailable: receipt != null };
  }
  async models(project, sessionId) {
    const row = sessionId
      ? (await this.raw({ id: sessionId })).find((s) => s.id === sessionId)
      : null;
    return {
      options: row?.model ? [{ id: row.model, label: row.model }] : [],
      current: row?.model || null,
      canSwitch: false,
      reason: "沿用 Claude Desktop 当前会话模型",
    };
  }
  async close() {
    await this.client.close();
    this.pages.clear();
    this.metadata.clear();
  }
}
