import path from "node:path";
import { ClaudeDesktopClient } from "./claude-desktop-client.mjs";
import { canonicalDesktopSessionId } from "./cowork-session-id.mjs";
import {
  remoteMessages,
  remoteSessionStatus,
  userEvent,
  nativeRequestId,
} from "./claude-desktop-events.mjs";
import { ClaudeCloudCatalog } from "./claude-cloud-catalog.mjs";
import { WeightedCache } from "./weighted-cache.mjs";

export class ClaudeDesktopRemote {
  constructor(root, options = {}) {
    this.root = root;
    this.watchPaths = [
      { path: path.join(root, "config.json") },
      { path: path.join(root, "Cookies") },
    ];
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
    this.catalog = new ClaudeCloudCatalog(this.root, this.client, {
      now: this.now,
    });
    this.emptyState = "当前账号暂无可读取的云端会话。";
  }
  async connect() {
    return this.client.connect();
  }
  receiptId(requestId) {
    return nativeRequestId(requestId);
  }
  async sessions(projectId, options = {}) {
    return (await this.raw({ projectId, limit: options.limit || 40 }))
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
  row(metadata, source) {
    if (canonicalDesktopSessionId(metadata.id) !== source.remoteId)
      throw Error("Claude 会话身份不一致。");
    return {
      ...source,
      native: undefined,
      title: metadata.title || "未命名会话",
      status: remoteSessionStatus(metadata),
      updatedAt: Date.parse(metadata.updated_at || metadata.created_at) || 0,
      revision: [
        metadata.last_event_at,
        metadata.updated_at,
        metadata.worker_status,
        metadata.status,
      ].join(":"),
      nativeUnread:
        typeof metadata.unread === "boolean" ? metadata.unread : undefined,
      model: metadata.config?.model,
      readOnly: metadata.status === "archived",
      canReply: metadata.status !== "archived",
      readOnlyReason:
        metadata.status === "archived" ? "此会话已在 Claude 归档。" : undefined,
      offline:
        metadata.environment_kind === "bridge" &&
        metadata.connection_status !== "connected",
      pending: [],
    };
  }
  async raw(selection = {}) {
    const catalog = await this.catalog.get({
      fresh: selection.refreshCatalog === true,
      stale: !!(selection.projectId || selection.id),
    });
    const project = catalog.projects.find(
      (p) =>
        p.id === selection.projectId || p.aliases.includes(selection.projectId),
    );
    const selected = catalog.rows.filter(
      (row) =>
        (!selection.id || row.id === selection.id) &&
        (!selection.projectId ||
          row.projectId === (project?.id || selection.projectId)),
    );
    if (selection.id && !selected.length && !selection.fresh) return this.raw({...selection,fresh:true});
    if (selection.id && selected.length) {
      const source = selected[0];
      return [
        await this.cachedMetadata(
          source.id,
          async () => {
            const result = await this.client.request(
              "/v1/code/sessions/" + source.remoteId,
              { scope: source.scope },
            );
            return this.row(result.session || result.response_shape, source);
          },
          { fresh: selection.fresh === true },
        ),
      ];
    }
    return selected.map((source) => this.row(source.native, source));
  }
  async projects() {
    return (await this.catalog.get({ stale: true })).projects;
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
    return {
      ...visible,
      ...(await this.page(row)),
      executionIssue:
        row.status === "failed"
          ? {
              retrying: false,
              message:
                "Cowork 执行失败，请检查原会话；当前接口未提供具体错误原因。",
            }
          : null,
    };
  }
  async history(id, cursor) {
    const row = (await this.raw({ id })).find((s) => s.id === id);
    if (!row?.remoteId)
      throw Object.assign(Error("Claude 会话不存在或账号已切换。"), {
        status: 404,
      });
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
    this.catalog.clear();
  }
}
