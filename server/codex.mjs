import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { CodexReadOnly } from "./codex-readonly.mjs";
import { SharedRpc } from "./shared-rpc.mjs";
import { sharedProfile } from "./shared-config.mjs";
import { userFacingText } from "./messages.mjs";
import { textContent } from "./content.mjs";
import { ReadCoordinator } from "./read-coordinator.mjs";
import { WeightedCache } from "./weighted-cache.mjs";
const home = process.env.HOME;
export function executionIssue(error, retrying = false, turnId) {
  const message = typeof error === "string" ? error : error?.message;
  return message ? { message: message.slice(0, 4000), retrying, turnId } : null;
}

export function codexFold(x, s) {
  const p = x.payload || {};
  if (x.type === "turn_context") {
    s.model = p.model;
    s.effort = p.effort;
  }
  if (x.type === "event_msg") {
    if (p.type === "task_started") {
      s.executionIssue = null;
      s.status = "running";
      s.turnId = p.turn_id;
    }
    if (p.type === "task_complete") {
      s.executionIssue = null;
      s.status = "completed";
      s.completedAt = x.timestamp;
    }
    if (p.type === "turn_aborted") s.status = "interrupted";
    if (p.type === "error") {
      s.executionIssue = executionIssue(p.error || p.message, p.willRetry === true, p.turn_id);
      s.status = p.willRetry === true ? "running" : "failed";
    }
  }
  if (
    x.type === "response_item" &&
    p.type === "message" &&
    ["user", "assistant"].includes(p.role) &&
    p.channel !== "analysis"
  ) {
    const kinds =
      p.internal_chat_message_metadata_passthrough?.content_item_kinds;
    if (
      p.role === "user" &&
      Array.isArray(kinds) &&
      !kinds.some((k) => k.startsWith("user."))
    )
      return;
    const content =
      p.role === "user" &&
      Array.isArray(kinds) &&
      Array.isArray(p.content) &&
      kinds.length === p.content.length
        ? p.content.filter((_, i) => kinds[i].startsWith("user."))
        : p.content;
    const raw = textContent(content);
    const text = p.role === "user" ? userFacingText(raw) : raw;
    if (text)
      s.messages.push({
        id: String(x.ordinal ?? x.timestamp) + ":" + p.role,
        role: p.role,
        text,
        time: x.timestamp,
      });
    if (s.messages.length > 500) s.messages.shift();
  }
}

export class Codex {
  constructor(id, dir, options = {}) {
    this.id = id;
    this.home = dir;
    this.watchPaths = [
      { path: path.join(dir, "sessions"), recursive: true },
      { path: dir },
    ];
    this.rpc = new CodexReadOnly(dir);
    const profile = sharedProfile(id);
    const shared =
      profile && path.resolve(profile.home) === path.resolve(dir)
        ? profile
        : null;
    this.control =
      options.control ||
      (shared
        ? new SharedRpc(shared.endpoint, {
            tokenFile: shared.tokenFile,
            stateFile: shared.stateFile,
            home: dir,
          })
        : null);
    this.readOnly = !this.control;
    this.logReads = new ReadCoordinator();
    this.logs = new WeightedCache({
      maxWeight: options.logCacheBytes ?? 16 * 1024 * 1024,
      weigh: (entry) =>
        512 +
        entry.state.messages.reduce(
          (bytes, message) => bytes + 256 + message.text.length * 2,
          0,
        ),
    });
    this.summaryCache = new Map();
    this.owned = new Set();
    this.active = new Map();
    this.pending = new Map();
    this.accepted = new Map();
    this.executionIssues = new Map();
    this.errorSnapshots = new Map();
    this.control?.on("message", (message) => this.onMessage(message));
    this.control?.on("disconnect", () => {
      this.onChange?.();
      this.owned.clear();
      this.active.clear();
      this.pending.clear();
    });
    this.rpc.on("message", (m) => this.onMessage(m));
    this.rpc.on("disconnect", () => {
      this.owned.clear();
      this.active.clear();
      this.pending.clear();
    });
  }
  onMessage(m) {
    if (m.method) this.onChange?.();
    const p = m.params || {},
      id = p.threadId;
    this.executionIssues ??= new Map();
    if (id && m.method === "error") {
      const issue = executionIssue(p.error, p.willRetry === true, p.turnId);
      if (issue) this.executionIssues.set(id, issue);
      if (this.executionIssues.size > 200) this.executionIssues.delete(this.executionIssues.keys().next().value);
    }
    if (
      ["item/started", "item/completed"].includes(m.method) &&
      p.item?.type === "userMessage"
    ) {
      const clientId = p.item.clientId ?? p.item.clientUserMessageId;
      if (id && clientId) {
        const ids = this.accepted.get(id) || new Set();
        ids.add(clientId);
        if (ids.size > 500) ids.delete(ids.values().next().value);
        this.accepted.set(id, ids);
        if (this.accepted.size > 100)
          this.accepted.delete(this.accepted.keys().next().value);
      }
    }
    if (m.method === "turn/started") {
      this.executionIssues.delete(id);
      this.active.set(id, { status: "running", turnId: p.turn.id });
    }
    if (m.method === "turn/completed") {
      const issue = executionIssue(p.turn?.error, false, p.turn?.id);
      if (issue) this.executionIssues.set(id, issue);
      else this.executionIssues.delete(id);
      this.active.delete(id);
      for (const [key, v] of this.pending)
        if (v.sessionId === id) this.pending.delete(key);
    }
    if (m.id !== undefined && m.method) {
      if (
        [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
        ].includes(m.method)
      )
        this.pending.set(String(m.id), {
          id: String(m.id),
          rpcId: m.id,
          sessionId: id,
          kind: "approval",
          title: p.command || p.reason || "File changes",
          detail: p.reason || JSON.stringify(p.changes || {}).slice(0, 4000),
        });
      else if (m.method === "item/tool/requestUserInput")
        this.pending.set(String(m.id), {
          id: String(m.id),
          rpcId: m.id,
          sessionId: id,
          kind: "question",
          questions: p.questions,
        });
      else
        this.control?.respond(m.id, undefined, {
          code: -32601,
          message: "Unsupported client request; no automatic approval",
        });
    }
  }
  async state() {
    return JSON.parse(
      await fs
        .readFile(path.join(this.home, ".codex-global-state.json"), "utf8")
        .catch(() => "{}"),
    );
  }
  async projects() {
    if (this.projectCache && Date.now() - this.projectCache.time < 5000)
      return this.projectCache.data;
    const s = await this.state();
    const native = await this.rpc.call("project/list", { limit: 100 });
    const data = native.data
      .filter((p) => p.roots?.[0]?.path)
      .map((p) => ({
        id: p.id,
        nativeId: p.id,
        canCreate: !this.readOnly,
        name: p.name,
        path: p.roots[0].path,
        roots: p.roots.map((r) => r.path),
      }));
    data.push({
      id: "__unassigned",
      name: "未分组",
      path: home,
      canCreate: false,
    });
    this.projectCache = { time: Date.now(), data, state: s };
    return data;
  }
  projectFor(t) {
    const { data, state: s } = this.projectCache;
    if (t.projectId && data.some((p) => p.id === t.projectId))
      return t.projectId;
    const legacy = s["thread-project-assignments"]?.[t.id]?.projectId;
    const native =
      s["app-server-project-id-by-legacy-project-id-by-host"]?.[
        "local:" + this.home
      ]?.[legacy];
    if (native && data.some((p) => p.id === native)) return native;
    if ((s["projectless-thread-ids"] || []).includes(t.id))
      return "__unassigned";
    return data.find((p) => p.roots?.includes(t.cwd))?.id || "__unassigned";
  }
  async listRaw() {
    if (this.listCache && Date.now() - this.listCache.time < 4000)
      return this.listCache.data;
    const data = [];
    let cursor = null;
    do {
      const x = await this.rpc.call("thread/list", {
        limit: 500,
        cursor,
        modelProviders: [],
        sourceKinds: ["cli", "vscode", "appServer", "unknown"],
        sortKey: "updated_at",
        useStateDbOnly: true,
      });
      data.push(...x.data);
      cursor = x.nextCursor;
    } while (cursor);
    this.listCache = { time: Date.now(), data };
    return data;
  }
  async log(t) {
    return this.logReads.run([t.path], () => this.readLog(t));
  }
  async readLog(t) {
    if (!t.path) return { status: "unknown", messages: [] };
    let real;
    try {
      real = await fs.realpath(t.path);
    } catch (e) {
      if (e.code === "ENOENT") return { status: "unknown", messages: [] };
      throw e;
    }
    const root = await fs.realpath(this.home);
    if (!real.startsWith(root + path.sep))
      throw Error("Session path outside agent home");
    const st = await fs.stat(real);
    let cache = this.logs.get(real);
    if (
      cache?.size === st.size &&
      cache.mtime === st.mtimeMs &&
      cache.ino === st.ino &&
      cache.ctime === st.ctimeMs
    )
      return cache.state;
    if (
      !cache ||
      st.ino !== cache.ino ||
      st.size < cache.size ||
      (st.size === cache.observedSize &&
        (cache.mtime !== st.mtimeMs || cache.ctime !== st.ctimeMs))
    ) {
      let start = 0;
      if (st.size > 1024 * 1024) {
        const file = await fs.open(real, "r");
        try {
          const tail = Buffer.alloc(1024 * 1024);
          const { bytesRead } = await file.read(
            tail,
            0,
            tail.length,
            st.size - tail.length,
          );
          const newline = tail.subarray(0, bytesRead).indexOf(10);
          if (newline >= 0) start = st.size - tail.length + newline + 1;
        } finally {
          await file.close();
        }
      }
      cache = {
        size: start,
        state: { status: "unknown", messages: [], truncated: start > 0 },
      };
    }
    let state = { ...cache.state, messages: [...cache.state.messages] };
    async function consume(start, state) {
      let committed = start;
      if (st.size <= start) return committed;
      const stream = createReadStream(real, {
        start,
        end: st.size - 1,
      });
      const decoder = new StringDecoder("utf8");
      let buffer = "";
      for await (const chunk of stream) {
        buffer += decoder.write(chunk);
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          committed += Buffer.byteLength(line) + 1;
          try {
            codexFold(JSON.parse(line), state);
          } catch {}
        }
      }
      return committed;
    }
    let committed = await consume(cache.size, state);
    if (state.truncated && !state.messages.length) {
      state = { status: "unknown", messages: [] };
      committed = await consume(0, state);
    }
    if (state.status === "unknown" && state.truncated) {
      // Recent output can exceed the tail window; lifecycle must span the whole log.
      for await (const line of createInterface({
        input: createReadStream(real, { end: Math.max(0, committed - 1) }),
        crlfDelay: Infinity,
      })) {
        try {
          const event = JSON.parse(line);
          if (
            event.type === "event_msg" &&
            ["task_started", "task_complete", "turn_aborted", "error"].includes(
              event.payload?.type,
            )
          )
            codexFold(event, state);
        } catch {}
      }
    }
    this.logs.set(real, {
      size: Math.min(committed, st.size),
      observedSize: st.size,
      ino: st.ino,
      ctime: st.ctimeMs,
      mtime: st.mtimeMs,
      state,
    });
    return state;
  }
  async row(t, withMessages = false) {
    await this.projects();
    const log = withMessages
      ? await this.log(t)
      : {
          status:
            t.status?.type === "active"
              ? "running"
              : this.summaryCache.get(t.id)?.revision === String(t.updatedAt)
                ? this.summaryCache.get(t.id).status
                : "unknown",
          messages: [],
        };
    const runtime = this.active.get(t.id);
    let status = runtime?.status || log.status;
    const pending = [...this.pending.values()].filter(
      (p) => p.sessionId === t.id,
    );
    if (pending.length) status = "waiting";
    const revision = String(t.updatedAt);
    const readState =
      this.projectCache?.state?.["electron-thread-read-state-v1"];
    const identities = readState?.unreadByIdentity || {};
    const identity =
      identities[readState?.legacyMigration?.identityKey] ||
      (Object.keys(identities).length === 1
        ? Object.values(identities)[0]
        : {});
    const nativeUnread = Object.entries(identity || {}).some(
      ([host, ids]) =>
        host.startsWith("local:") && Array.isArray(ids) && ids.includes(t.id),
    );
    const r = {
      id: t.id,
      projectId: this.projectFor(t),
      title: t.name || t.preview?.slice(0, 90) || "新会话",
      status,
      updatedAt: Math.max(
        t.updatedAt * 1000,
        Date.parse(log.messages.at(-1)?.time) || 0,
      ),
      revision,
      nativeUnread,
      canReply: !this.readOnly,
      readOnly: this.readOnly,
      ...(this.readOnly
        ? { readOnlyReason: "Codex 桌面写入保护中，暂时仅查看会话。" }
        : {}),
      model: log.model || t.model || null,
      effort: log.effort || null,
      pending: pending.map(({ rpcId, ...p }) => p),
      executionIssue: log.executionIssue || null,
    };
    if (withMessages) {
      r.messages = log.messages.slice(-80);
      r.hasMore = log.messages.length > 80 || !!log.truncated;
      r.historyCursor = r.hasMore ? r.messages[0]?.id : null;
      r.liveExternal = status === "running" && !runtime;
    }
    return r;
  }
  async sessions(projectId, options = {}) {
    await this.projects();
    const threads = (await this.listRaw()).filter(
      (t) => this.projectFor(t) === projectId,
    );
    if (!this.summariesLoading) {
      const pending = threads
        .slice(0, options.limit || 40)
        .filter(
          (t) => this.summaryCache.get(t.id)?.revision !== String(t.updatedAt),
        );
      this.summariesLoading = true;
      void Promise.all(
        Array.from({ length: 4 }, async () => {
          while (pending.length) {
            const t = pending.shift();
            try {
              const log = await this.log(t);
              this.summaryCache.set(t.id, {
                revision: String(t.updatedAt),
                status: log.status,
              });
            } catch {}
          }
        }),
      ).finally(() => {
        this.summariesLoading = false;
      });
    }
    return Promise.all(threads.map((t) => this.row(t)));
  }
  async detail(id) {
    const { thread } = await this.rpc.call("thread/read", {
      threadId: id,
      includeTurns: false,
    });
    const row = await this.row(thread, true);
    if (this.control) {
      try {
        const snapshotKey = String(thread.updatedAt);
        const inspectTurns = !this.executionIssues.has(id) && this.errorSnapshots.get(id) !== snapshotKey;
        const live = await this.control.call("thread/read", {
          threadId: id,
          includeTurns: inspectTurns,
        });
        if (inspectTurns) {
          this.errorSnapshots.set(id, snapshotKey);
          if (this.errorSnapshots.size > 200) this.errorSnapshots.delete(this.errorSnapshots.keys().next().value);
        }
        const latest = live.thread.turns?.at(-1);
        if (latest?.error) {
          const issue = executionIssue(latest.error, latest.status === "inProgress", latest.id);
          if (issue) this.executionIssues.set(id, issue);
        }
        if (live.thread.status?.type === "active")
          row.status = row.pending.length ? "waiting" : "running";
        else if (
          live.thread.status?.type === "idle" &&
          ["running", "unknown"].includes(row.status)
        )
          row.status = "idle";
        const native = await this.nativeQueue(id);
        row.nativeQueue = native.map((q) => ({
          requestId: q.clientUserMessageId || "native:" + q.id,
          nativeId: q.id,
          native: true,
          text: userFacingText(textContent(q.input)),
          state: "queued",
        }));
      } catch {
        row.offline = true;
      }
    }
    row.acceptedRequestIds = [...(this.accepted.get(id) || [])];
    const issue = this.executionIssues.get(id) || row.executionIssue;
    if (issue) {
      row.executionIssue = issue;
      row.status = issue.retrying ? "running" : "failed";
      row.revision += ":" + JSON.stringify(issue);
    }
    return row;
  }
  async nativeQueue(id) {
    const data = [],
      seen = new Set();
    let cursor;
    do {
      const page = await this.control.call("thread/queue/list", {
        threadId: id,
        ...(cursor ? { cursor } : {}),
      });
      data.push(...page.data);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor))
        throw Error("Repeated native queue cursor");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return data;
  }
  async history(id, before) {
    const { thread } = await this.rpc.call("thread/read", {
      threadId: id,
      includeTurns: false,
    });
    const real = await fs.realpath(thread.path);
    if (!real.startsWith((await fs.realpath(this.home)) + path.sep))
      throw Error("Invalid session path");
    const s = { messages: [], status: "unknown" };
    for await (const line of createInterface({
      input: createReadStream(real),
      crlfDelay: Infinity,
    })) {
      let x;
      try {
        x = JSON.parse(line);
      } catch {
        continue;
      }
      if (String(x.ordinal ?? x.timestamp) + ":" + x.payload?.role === before)
        break;
      codexFold(x, s);
    }
    return {
      messages: s.messages.slice(-80),
      hasMore: s.messages.length > 80,
      historyCursor: s.messages.slice(-80)[0]?.id,
    };
  }
  async models(project, sessionId) {
    if (this.control) {
      const { data } = await this.control.call("model/list", {
        includeHidden: false,
      });
      const options = data.map((m) => ({
        id: m.model,
        model: m.model,
        label: m.displayName || m.model,
        efforts: (m.supportedReasoningEfforts || []).map(
          (e) => e.reasoningEffort,
        ),
      }));
      const thread = sessionId
        ? (await this.rpc.call("thread/read", { threadId: sessionId })).thread
        : null;
      return {
        options,
        current:
          thread?.model ||
          options[data.findIndex((m) => m.isDefault)]?.id ||
          null,
        currentEffort: thread?.reasoningEffort || null,
        canSwitch: true,
      };
    }
    return {
      options: [],
      current: null,
      canSwitch: false,
      reason: "Codex 桌面写入保护中",
    };
  }
  async create(project, model) {
    if (this.control) {
      const { thread } = await this.control.call("thread/start", {
        projectId: project.nativeId,
        cwd: project.path,
        ...(model ? { model: model.model } : {}),
      });
      this.owned.add(thread.id);
      this.active.set(thread.id, { status: "idle" });
      this.listCache = null;
      return { id: thread.id };
    }
    throw Object.assign(Error("Codex 桌面写入保护中"), { status: 409 });
  }
  async send(id, text, requestId, model) {
    if (this.control) {
      if (this.owned.has(id) && this.active.get(id)?.status === "idle") {
        const result = await this.control.call("turn/start", {
          threadId: id,
          input: [{ type: "text", text }],
          clientUserMessageId: requestId,
          ...(model?.model ? { model: model.model } : {}),
          ...(model?.effort ? { effort: model.effort } : {}),
        });
        this.active.set(id, { status: "running", turnId: result.turn.id });
        this.listCache = null;
        return { accepted: true };
      }
      try {
        await this.control.connect();
      } catch (e) {
        throw Object.assign(e, { retrySafe: true });
      }
      const existing = await this.control.call("thread/queue/list", {
        threadId: id,
        limit: 1,
      });
      if (existing.data.length)
        throw Object.assign(Error("等待桌面排队消息先完成"), {
          retrySafe: true,
        });
      if (!this.owned.has(id))
        await this.control.call("thread/resume", {
          threadId: id,
          excludeTurns: true,
        });
      const { thread } = await this.control.call("thread/read", {
        threadId: id,
        includeTurns: false,
      });
      if (thread.status?.type === "active")
        throw Object.assign(Error("当前轮次正在运行"), { retrySafe: true });
      const native = await this.control.call("thread/queue/list", {
        threadId: id,
        limit: 1,
      });
      if (native.data.length)
        throw Object.assign(Error("等待桌面排队消息先完成"), {
          retrySafe: true,
        });
      if (model)
        await this.control.call("thread/settings/update", {
          threadId: id,
          ...(model.model ? { model: model.model } : {}),
          ...(model.effort ? { effort: model.effort } : {}),
        });
      const result = await this.control.call("thread/queue/add", {
        threadId: id,
        input: [{ type: "text", text }],
        clientUserMessageId: requestId,
      });
      const queueId = result.queuedSubmission.id;
      try {
        const [head, live] = await Promise.all([
          this.control.call("thread/queue/list", { threadId: id, limit: 1 }),
          this.control.call("thread/read", {
            threadId: id,
            includeTurns: false,
          }),
        ]);
        // An interrupted native turn can pause its queue. Start only our own head item.
        if (live.thread.status?.type === "idle" && head.data[0]?.id === queueId)
          await this.control.call("thread/queue/start", {
            threadId: id,
            queuedSubmissionId: queueId,
          });
      } catch {}
      this.listCache = null;
      return { accepted: true, nativeQueueId: queueId };
    }
    throw Object.assign(Error("Codex 桌面写入保护中"), { status: 409 });
  }
  async answer(id, approvalId, body) {
    const p = this.pending.get(approvalId);
    if (!p || p.sessionId !== id)
      throw Object.assign(Error("请求已失效"), { status: 409 });
    if (p.kind === "approval")
      this.control.respond(p.rpcId, {
        decision: body.allow === true ? "accept" : "decline",
      });
    else {
      const answers = {};
      for (const q of p.questions || [])
        answers[q.id] = { answers: [String(body.answers?.[q.id] || "")] };
      this.control.respond(p.rpcId, { answers });
    }
    this.pending.delete(approvalId);
    return { accepted: true };
  }
  close() {
    this.logs.clear();
    this.control?.close();
    this.rpc.close();
  }
}
