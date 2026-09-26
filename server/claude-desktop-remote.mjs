import path from "node:path";
import { ClaudeDesktopClient } from "./claude-desktop-client.mjs";
import { canonicalDesktopSessionId } from "./cowork-session-id.mjs";
import {
  remoteMessages,
  remoteSessionStatus,
  userEvent,
  nativeRequestId,
} from "./claude-desktop-events.mjs";
import {
  ClaudeModels,
  settingEvents,
  controlResult,
} from "./claude-models.mjs";
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
    this.modelSettings = new ClaudeModels(this.client, { now: this.now });
    this.created = new Map();
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
      effort: metadata.config?.effort_level,
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
    const sources = [...catalog.rows];
    for (const [id, row] of this.created) {
      if (row.scope !== catalog.scope || sources.some((s) => s.id === id))
        this.created.delete(id);
      else sources.push(row);
    }
    const selected = sources.filter(
      (row) =>
        (!selection.id || row.id === selection.id) &&
        (!selection.projectId ||
          row.projectId === (project?.id || selection.projectId)),
    );
    if (selection.id && !selected.length && !selection.refreshCatalog)
      return this.raw({ ...selection, refreshCatalog: true });
    if (
      selection.id &&
      selected.length &&
      !selection.fresh &&
      this.now() - catalog.time < 2500
    ) {
      const newer = this.metadata.get(selected[0].id);
      return [
        newer && newer.time > catalog.time
          ? newer.row
          : this.row(selected[0].native, selected[0]),
      ];
    }
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
          "/events?limit=100&sort_order=desc" +
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
  async send(id, text, requestId, model) {
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
    if (model) {
      try {
        await this.applySettings(row, model, requestId);
      } catch (error) {
        this.metadata.clear();
        if (this.catalog.cached) this.catalog.cached.time = this.now() - 5001;
        error.delivery = "not-sent";
        if (!error.message.includes("可能已切换")) error.message = "模型或强度可能已切换；消息未发送。" + error.message;
        error.blocked = true;
        throw error;
      }
    }
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
    if (this.catalog.cached) this.catalog.cached.time = this.now() - 5001;
    this.onChange?.();
    return { accepted: true, requestId, receiptAvailable: receipt != null };
  }
  async models(project, sessionId) {
    const row = sessionId
      ? (await this.raw({ id: sessionId })).find((s) => s.id === sessionId)
      : null;
    const result = await this.modelSettings.get({
      model: row?.model,
      effort: row?.effort,
    });
    return { ...result, canSwitch: !row?.readOnly };
  }
  async createAndSend(project, text, requestId, selected) {
    let submitted = false;
    try {
      const catalog = await this.catalog.get();
      const current = catalog.projects.find((p) => p.id === project.id);
      if (!current || !current.canCreate)
        throw Object.assign(Error("请选择可用的云端项目"), {
          status: 400,
          delivery: "not-sent",
        });
      const models = await this.modelSettings.get();
      const model =
        selected || models.options.find((m) => m.id === models.current);
      const owner = await this.client.identity(),
        scope = owner.account + ":" + owner.organization;
      if (scope !== catalog.scope)
        throw Object.assign(Error("Claude 账号已切换，请刷新会话。"), {
          status: 409,
          delivery: "not-sent",
        });
      submitted = true;
      const result = await this.client.request(
        "/api/organizations/" + owner.organization + "/cowork/sessions",
        {
          method: "POST",
          scope,
          body: {
            message: text,
            message_uuid: nativeRequestId(requestId),
            ...(current.uuid ? { project_uuid: current.uuid } : {}),
            ...(model ? { model: model.id } : {}),
            ...(model?.effort || model?.defaultEffort
              ? { effort_level: model.effort || model.defaultEffort }
              : {}),
          },
        },
      );
      const native = result.session,
        remoteId = canonicalDesktopSessionId(native?.id);
      if (!remoteId)
        throw Object.assign(
          Error("新会话创建结果未确认，请刷新列表核对，不会自动重建。"),
          { status: 503, delivery: "unknown" },
        );
      const source = {
        native: {
          ...native,
          config: native.config || {
            model: model?.id,
            effort_level: model?.effort || model?.defaultEffort,
          },
        },
        id: "remote:" + scope + ":" + remoteId,
        scope,
        remoteId,
        projectId: current.id,
        projectName: current.name,
        workspace: "",
      };
      this.created.set(source.id, source);
      while (this.created.size > 50)
        this.created.delete(this.created.keys().next().value);
      this.catalog.cached = null;
      this.onChange?.();
      return {
        id: source.id,
        projectId: current.id,
        title: native.title || "新会话",
        accepted: true,
      };
    } catch (error) {
      if (!submitted) error.delivery = "not-sent";
      throw error;
    }
  }
  async applySettings(row, model, requestId) {
    const targetModel = model.id !== row.model ? model.id : undefined;
    const targetEffort =
      model.effort || (targetModel ? model.defaultEffort : undefined);
    const desiredEffort =
      targetModel || targetEffort !== row.effort ? targetEffort : undefined;
    const body = settingEvents(
      row.remoteId,
      nativeRequestId(requestId),
      targetModel,
      desiredEffort,
    );
    if (!body.events.length) return;
    await this.client.request("/v1/code/sessions/" + row.remoteId + "/events", {
      method: "POST",
      scope: row.scope,
      body,
    });
    const ids = body.events.map((e) => e.payload.request_id);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const events = await this.client.request(
        "/v1/code/sessions/" +
          row.remoteId +
          "/events?limit=100&sort_order=desc",
        { scope: row.scope },
      );
      const result = controlResult(events.data || [], ids);
      if (result.error)
        throw Object.assign(Error(result.error), {
          status: 409,
          delivery: "not-sent",
        });
      if (result.complete) {
        this.metadata.clear();
        this.pages.clear();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw Object.assign(
      Error("模型或强度可能已切换，但确认尚未收到；消息未发送，请核对原会话后重试。"),
      { status: 409, delivery: "not-sent" },
    );
  }
  async close() {
    await this.client.close();
    this.pages.clear();
    this.metadata.clear();
    this.catalog.clear();
    this.modelSettings.clear();
    this.created.clear();
  }
}
