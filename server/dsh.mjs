import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import WebSocket from "ws";
import { textContent } from "./content.mjs";
import { DshAuth, pairingRequired } from "./dsh-auth.mjs";
import { DshRemote } from "./dsh-remote.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// dsh 0.2 deduplicates prompts by UUID requestId; derive a stable one from
// Pokite's request id so a retried send is recognised, not re-inserted.
function promptRequestId(requestId) {
  if (!requestId) return randomUUID();
  if (UUID.test(requestId)) return requestId.toLowerCase();
  const h = createHash("sha256").update(String(requestId)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const address = (sessionId) => ({ kind: "session", sessionId });

export class Dsh {
  constructor(url, { authFile, launchLog } = {}) {
    this.id = "dsh";
    this.base = url || process.env.DSH_URL || "http://127.0.0.1:3080";
    this.auth = new DshAuth(this.base, {
      ...(authFile ? { file: authFile } : {}),
      launchLog,
    });
    this.remote = new DshRemote(this.base, {
      fetchAuthorized: (route, init) => this.fetchAuthorized(route, init),
      headers: () => this.headers(),
    });
    this.pending = new Map();
    this.statusCache = new Map();
    this.acceptedPrompts = new Map();
  }
  // 0.1 speaks dotted methods over /api/events.mux; 0.2 speaks
  // namespace/method with payload.args over /api/remote.mux. Detected once,
  // and again whenever a call hits a route the server no longer has.
  version() {
    this.versionCheck ??= (async () => {
      const response = await this.fetchAuthorized("/api/session/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: randomUUID(),
          method: "session/list",
          payload: { args: { _request: {} } },
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 404) return 1;
      if (!response.ok)
        throw Object.assign(Error("DeepSeek Harness HTTP " + response.status), {
          httpStatus: response.status,
        });
      const body = await response.json();
      if (!body?.result?.ok || !Array.isArray(body.result.value?.items))
        throw Error("DeepSeek Harness 协议探测响应无效");
      return 2;
    })().catch((error) => {
      this.versionCheck = null;
      throw error;
    });
    return this.versionCheck;
  }
  async rpc(method, args) {
    try {
      return await this.remote.call(method, args);
    } catch (error) {
      if (error.httpStatus === 404) this.versionCheck = null;
      // dsh 0.2 allows one writer per session; the Desktop app and each
      // `dsh web` are separate writers that keep a session until they exit.
      if (error.code === "session/writer-held")
        throw Object.assign(
          Error(
            "这个会话正被另一个 DeepSeek Harness 进程（通常是桌面版）占用，只能在那边继续；退出桌面版后才能从 Pokite 发送。",
          ),
          { status: 409, code: error.code, delivery: "not-sent" },
        );
      throw error;
    }
  }
  async workspaces() {
    if (this.workspaceState) return this.workspaceState;
    this.workspaceWatch ??= new Promise((resolve, reject) => {
      let state = null;
      const timer = setTimeout(() => {
        cancel();
        this.workspaceWatch = null;
        reject(Error("DeepSeek Harness 响应超时：workspace/follow"));
      }, 20000);
      const cancel = this.remote.stream(
        "workspace/follow",
        {},
        {
          item: (frame) => {
            if (frame.type === "baseline")
              state = {
                items: new Map(
                  frame.value.items.map((w) => [w.workspaceId, w]),
                ),
                order: frame.value.items.map((w) => w.workspaceId),
                archived: new Set(frame.value.archivedSessionIds),
              };
            else if (!state) return;
            else if (frame.type === "upsert") {
              const id = frame.workspace.workspaceId;
              if (!state.items.has(id)) state.order.push(id);
              state.items.set(id, frame.workspace);
            } else if (frame.type === "remove") {
              state.items.delete(frame.workspaceId);
              state.order = state.order.filter((x) => x !== frame.workspaceId);
            } else if (frame.type === "order") state.order = frame.workspaceIds;
            else if (frame.type === "archived")
              state.archived = new Set(frame.archivedSessionIds);
            clearTimeout(timer);
            this.workspaceState = state;
            resolve(state);
            if (frame.type !== "baseline") this.onChange?.();
          },
          end: (error) => {
            clearTimeout(timer);
            this.workspaceState = null;
            this.workspaceWatch = null;
            reject(error || Error("DeepSeek Harness 工作区数据流已结束"));
          },
        },
      );
    });
    return this.workspaceWatch;
  }
  // Live projection frames (titles, queues, questions) drive UI refreshes.
  watchControl() {
    if (this.controlCancel) return;
    this.controlCancel = this.remote.stream(
      "session/control",
      {},
      {
        item: (frame) => {
          if (frame.type === "projection") this.onChange?.();
        },
        end: () => {
          this.controlCancel = null;
        },
      },
    );
  }
  // dsh 0.2 forwards approval and question requests to every live client
  // over $events and cancels them once any client (or the Desktop app)
  // settles them. Unanswered requests keep the tool waiting, as in dsh's UI.
  watchEvents() {
    if (this.eventsCancel) return;
    const clear = () => {
      for (const [id, p] of this.pending)
        if (p.eventId) this.pending.delete(id);
    };
    this.eventsCancel = this.remote.stream(
      "$events",
      {},
      {
        item: (frame) => {
          if (frame.type === "ready") this.eventsClient = frame.clientId;
          else if (frame.type === "cancel") this.pending.delete(frame.eventId);
          else if (frame.type !== "waterfall") return;
          else if (frame.event === "approval/request")
            this.pending.set(frame.eventId, {
              id: frame.eventId,
              eventId: frame.eventId,
              sessionId: frame.agentId,
              kind: "approval",
              title: frame.request.toolName,
              detail:
                frame.request.displayReason?.["zh-CN"] ??
                frame.request.displayReason?.zh ??
                frame.request.reason,
            });
          else if (frame.event === "user-questions/request")
            this.pending.set(frame.eventId, {
              id: frame.eventId,
              eventId: frame.eventId,
              sessionId: frame.agentId,
              kind: "question",
              questions: frame.request.questions,
              callId: frame.request.wait?.callId,
            });
          else return;
          this.onChange?.();
        },
        end: () => {
          clear();
          this.eventsCancel = null;
          this.eventsClient = null;
        },
      },
    );
  }
  // Questions whose tool call already returned stay answerable through
  // userQuestions/answer; open ones arrive over $events instead.
  syncContinuedQuestions(sessionId, view) {
    for (const [id, p] of this.pending)
      if (p.sessionId === sessionId && p.continued) this.pending.delete(id);
    for (const q of view?.active || [])
      if (q.state === "continued")
        this.pending.set("question:" + q.callId, {
          id: "question:" + q.callId,
          sessionId,
          kind: "question",
          questions: q.questions,
          callId: q.callId,
          continued: true,
        });
  }
  async sessionList() {
    return (await this.version()) === 2
      ? this.rpc("session/list", { _request: {} })
      : this.call("session.list");
  }
  // Newest events of a session, shaped like the 0.1 history response.
  // Reads must not use session/follow: it activates the session afterwards
  // and takes its write lock for the life of this dsh process, blocking the
  // Desktop app from continuing it. session/projections and session/page
  // read persistence without activation. The projections baseline asOfSeq
  // is the event cursor; list rows' asOfSeq is a cache seq and is not.
  async tail(id, maxMessages) {
    if ((await this.version()) === 1)
      return this.call("session.history", { sessionId: id, maxMessages });
    const baseline = await this.rpc("session/projections", {
      request: { sessionId: id },
    });
    if (!baseline)
      throw Object.assign(Error("Session not found"), { status: 404 });
    const page = await this.rpc("session/page", {
      request: {
        address: address(id),
        throughSeq: baseline.asOfSeq,
        maxMessages,
      },
    });
    return {
      events: page.records,
      hasMore: page.hasMore,
      cursor: baseline.asOfSeq,
      projections: baseline.values,
    };
  }
  headers(extra = {}) {
    const cookie = this.auth.cookie();
    return {
      Origin: this.base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    };
  }
  // dsh 0.2 answers 401 until paired; 0.1 never does. One re-pair attempt
  // from the launch log, then a pairing error instead of a bare HTTP 401.
  // Liveness for the connection badge, authenticated like every request so
  // an unpaired 0.2 server reports pairing instead of looking offline.
  async reachable() {
    const response = await this.fetchAuthorized("/", {
      method: "GET",
      signal: AbortSignal.timeout(2500),
    });
    await response.body?.cancel();
    return response.ok;
  }
  async fetchAuthorized(route, init) {
    let response = await fetch(this.base + route, {
      ...init,
      headers: this.headers(init.headers),
    });
    if (response.status !== 401) return response;
    if (!(await this.auth.recover())) throw pairingRequired();
    this.socket?.terminate();
    this.remote?.close();
    response = await fetch(this.base + route, {
      ...init,
      headers: this.headers(init.headers),
    });
    if (response.status === 401) {
      this.auth.forget();
      throw pairingRequired("配对后仍被拒绝");
    }
    return response;
  }
  connect() {
    if (this.socket) return;
    const socket = new WebSocket(
      this.base.replace(/^http/, "ws") + "/api/events.mux",
      { origin: this.base, headers: this.headers() },
    );
    this.socket = socket;
    socket.on("error", () => {});
    socket.on("close", () => {
      this.socket = null;
      this.pending.clear();
    });
    socket.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      const p = m.payload || {};
      if (p.type) this.onChange?.();
      if (p.type === "approval/requested")
        this.pending.set(m.rpcId, {
          id: m.rpcId,
          sessionId: p.sessionId,
          kind: "approval",
          title: p.toolName,
          detail: p.reason,
          approvalId: p.approvalId,
        });
      if (p.type === "question/requested")
        this.pending.set(m.rpcId, {
          id: m.rpcId,
          sessionId: p.sessionId,
          kind: "question",
          questions: p.questions,
        });
      if (p.type === "approval/resolved" || p.type === "question/resolved")
        for (const [id, v] of this.pending)
          if (
            (v.approvalId === p.approvalId && p.approvalId) ||
            id === p.questionRpcId
          )
            this.pending.delete(id);
    });
  }
  async call(method, payload = {}) {
    const rpcId = randomUUID();
    const r = await this.fetchAuthorized("/api/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      if (r.status === 404) this.versionCheck = null;
      throw Error("DeepSeek Harness HTTP " + r.status);
    }
    const x = await r.json();
    if (!x.result?.ok)
      throw Error(x.result?.error?.message || JSON.stringify(x.result));
    return x.result.value;
  }
  async projects() {
    if ((await this.version()) === 2) {
      this.watchControl();
      this.watchEvents();
      const { items, order, archived } = await this.workspaces();
      return order
        .map((id) => items.get(id))
        .filter(Boolean)
        .map((w) => ({
          id: w.workspaceId,
          path: w.path,
          name: w.title || path.basename(w.path),
          sessionIds: w.sessionIds.filter((s) => !archived.has(s)),
        }));
    }
    this.connect();
    return (await this.call("workspace.list")).items.map((w) => ({
      id: w.workspaceId,
      path: w.path,
      name: w.title || path.basename(w.path),
      sessionIds: w.sessionIds,
    }));
  }
  row(s, projectId) {
    const v = s.projections?.values || {};
    const pending = [...this.pending.values()].filter(
      (p) => p.sessionId === s.sessionId,
    );
    return {
      id: s.sessionId,
      projectId,
      title: v.title || "新会话",
      status: pending.length
        ? "waiting"
        : s.running
          ? "running"
          : this.statusCache.get(s.sessionId)?.revision ===
              s.projections?.asOfSeq
            ? this.statusCache.get(s.sessionId).status
            : s.blank
              ? "idle"
              : "unknown",
      updatedAt: s.updatedAt,
      revision: String(s.projections?.asOfSeq ?? s.updatedAt),
      canReply: !pending.length,
      model: null,
      pending,
    };
  }
  async sessions(projectId, options = {}) {
    const p = (await this.projects()).find((p) => p.id === projectId);
    if (!p) throw Error("Project not found");
    const { items } = await this.sessionList();
    const rows = items.filter(
      (s) => p.sessionIds.includes(s.sessionId) && !s.parentSessionId,
    );
    if (!this.summariesLoading) {
      const pending = rows
        .slice(0, options.limit || 40)
        .filter(
          (s) =>
            !s.running &&
            !s.blank &&
            this.statusCache.get(s.sessionId)?.revision !==
              s.projections?.asOfSeq,
        );
      this.summariesLoading = true;
      void Promise.all(
        Array.from({ length: 4 }, async () => {
          while (pending.length) {
            const s = pending.shift();
            try {
              const h = await this.tail(s.sessionId, 1);
              const end = h.events
                .map((x) => x.event)
                .filter((e) => e?.type === "turn/end")
                .at(-1);
              if (end)
                this.statusCache.set(s.sessionId, {
                  revision: s.projections?.asOfSeq,
                  status: this.endStatus(end),
                });
            } catch {}
          }
        }),
      ).finally(() => {
        this.summariesLoading = false;
      });
    }
    return rows.map((s) => this.row(s, projectId));
  }
  endStatus(e) {
    const k = e.data?.reason?.kind || e.data?.status;
    return k === "completed"
      ? "completed"
      : ["error", "failed"].includes(k)
        ? "failed"
        : "interrupted";
  }
  messages(h) {
    const messages = [];
    for (const { event: e } of h.events) {
      if (!e || !["user/message", "assistant/message"].includes(e.type))
        continue;
      const m = e.data.message || e.data;
      if (e.type === "user/message" && m.source?.kind !== "user") continue;
      const text = textContent(m.content);
      if (text)
        messages.push({
          id: String(e.seq),
          role: e.type.startsWith("user") ? "user" : "assistant",
          text,
          time: new Date(e.time).toISOString(),
        });
    }
    return messages;
  }
  async detail(id) {
    const projects = await this.projects();
    const p = projects.find((p) => p.sessionIds.includes(id));
    if (!p) throw Object.assign(Error("Session not found"), { status: 404 });
    const [h, list] = await Promise.all([
      this.tail(id, 30),
      this.sessionList(),
    ]);
    const s = list.items.find((s) => s.sessionId === id);
    if (!s) throw Error("Session missing");
    if (h.projections)
      this.syncContinuedQuestions(id, h.projections.userQuestions);
    const row = this.row(s, p.id);
    row.messages = this.messages(h);
    for (const { event: e } of h.events) {
      if (!e) continue;
      if (e.type === "user/message" || e.type === "turn/start")
        row.status = s.running ? "running" : "unknown";
      if (!s.running && e.type === "turn/end") row.status = this.endStatus(e);
      if (e.type === "turn/error" && !s.running) row.status = "failed";
    }
    // A pending approval or question outranks whatever the history implies.
    if (row.pending.length) row.status = "waiting";
    row.hasMore = h.hasMore;
    row.historyCursor = h.events[0]?.event?.seq;
    if (row.status === "failed") {
      const error = h.events
        .map((x) => x.event)
        .filter((e) => e?.type === "turn/error")
        .at(-1)?.data;
      row.executionIssue = {
        retrying: false,
        message: (typeof error?.message === "string"
          ? error.message
          : typeof error?.error?.message === "string"
            ? error.error.message
            : "DeepSeek Harness 本轮执行失败，原服务未提供具体错误。"
        ).slice(0, 4000),
      };
    }
    return row;
  }
  async history(id, before) {
    await this.detail(id);
    const seq = Number(before);
    if (!Number.isSafeInteger(seq) || seq < 0) throw Error("Invalid cursor");
    let h;
    if ((await this.version()) === 2) {
      const baseline = await this.rpc("session/projections", {
        request: { sessionId: id },
      });
      const page = await this.rpc("session/page", {
        request: {
          address: address(id),
          throughSeq: baseline?.asOfSeq ?? seq,
          beforeSeq: seq,
          maxMessages: 30,
        },
      });
      h = { events: page.records, hasMore: page.hasMore };
    } else
      h = await this.call("session.history", {
        sessionId: id,
        beforeSeq: seq,
        maxMessages: 30,
      });
    return {
      messages: this.messages(h),
      hasMore: h.hasMore,
      historyCursor: h.events[0]?.event?.seq,
    };
  }
  async models(p, sessionId) {
    let x;
    if ((await this.version()) === 2) {
      const [catalog, projections] = await Promise.all([
        this.rpc("session/modelCatalog", {}),
        sessionId
          ? this.rpc("session/projections", { request: { sessionId } })
          : null,
      ]);
      const selection = projections?.values?.modelSelection;
      x = {
        groups: catalog.groups,
        current: selection?.next || selection?.lastUsed || catalog.default,
      };
    } else
      x = await this.call(
        sessionId ? "session.models" : "llm.models",
        sessionId ? { sessionId } : {},
      );
    const options = x.groups.flatMap((g) =>
      g.models.map((m) => ({
        id: JSON.stringify([g.id, m.id]),
        label: m.name || m.id,
        model: m.id,
        provider: g.id,
        efforts: (m.reasoning?.efforts || []).map((e) => e.id),
      })),
    );
    return {
      options,
      current: x.current
        ? JSON.stringify([x.current.provider, x.current.model])
        : null,
      canSwitch: true,
      currentEffort: x.current?.reasoningEffort || null,
    };
  }
  async create(p, model) {
    const created =
      (await this.version()) === 2
        ? await this.rpc("session/create", {
            request: { workspaceId: p.id },
          })
        : await this.call("session.create", { workspaceId: p.id });
    return { id: created.sessionId };
  }
  async send(id, text, requestId, model) {
    // dsh 0.2 re-inserts a prompt retried while its first copy is claimed
    // but not yet journaled (verified on 0.2.0-rc.2), so remember accepted
    // request ids for a while and never resubmit them from this process.
    const key = requestId ? id + "\n" + requestId : null;
    const now = Date.now();
    for (const [k, time] of this.acceptedPrompts)
      if (now - time > 30 * 60 * 1000) this.acceptedPrompts.delete(k);
    if (key && this.acceptedPrompts.has(key)) return { accepted: true };
    if (model) {
      const d = await this.detail(id);
      if (["running", "waiting"].includes(d.status))
        throw Object.assign(Error("请等待本轮结束后切换模型"), {
          status: 409,
          retrySafe: true,
        });
      const selection = {
        sessionId: id,
        provider: model.provider,
        model: model.model,
        ...(model.effort ? { reasoningEffort: model.effort } : {}),
      };
      if ((await this.version()) === 2)
        await this.rpc("session/selectModel", { request: selection });
      else await this.call("session.selectModel", selection);
    }
    const prompt = {
      sessionId: id,
      mode: "queue",
      content: [{ type: "text", text }],
      clientTimeZone: "Asia/Shanghai",
    };
    if ((await this.version()) === 2)
      await this.rpc("session/prompt", {
        request: { requestId: promptRequestId(requestId), ...prompt },
      });
    else await this.call("session.prompt", prompt);
    if (key) this.acceptedPrompts.set(key, Date.now());
    return { accepted: true };
  }
  async answer(id, pid, body) {
    const p = this.pending.get(pid);
    if (!p || p.sessionId !== id)
      throw Object.assign(Error("审批已失效"), { status: 409 });
    if ((await this.version()) === 2) {
      // An option label counts as a selection; anything else is free text.
      const answer = {
        answers: (p.questions || []).map((q) => {
          const text = String(body.answers?.[q.id] || "");
          return q.options?.some((o) => o.label === text)
            ? { id: q.id, selected: [text] }
            : { id: q.id, selected: [], ...(text ? { custom: text } : {}) };
        }),
      };
      if (p.continued)
        await this.rpc("userQuestions/answer", {
          agentId: id,
          callId: p.callId,
          answer,
        });
      else
        await this.rpc("$events/result", {
          clientId: this.eventsClient,
          eventId: p.eventId,
          outcome: {
            kind: "result",
            value:
              p.kind === "approval"
                ? body.allow === true
                  ? "allowed-once"
                  : "rejected"
                : answer,
          },
        });
      this.pending.delete(pid);
      return { accepted: true };
    }
    const value =
      p.kind === "approval"
        ? {
            sessionId: id,
            approvalId: p.approvalId,
            outcome: body.allow === true ? "allowed-once" : "rejected",
          }
        : {
            sessionId: id,
            answer: {
              answers: (p.questions || []).map((q) => ({
                id: q.id,
                selected: [],
                custom: String(body.answers?.[q.id] || ""),
              })),
            },
          };
    const r = await this.fetchAuthorized("/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "client-response",
        rpcId: pid,
        result: { ok: true, value },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await r.json();
    if (!r.ok || result.accepted === false) throw Error("审批未送达");
    this.pending.delete(pid);
    return { accepted: true };
  }
  close() {
    this.socket?.close();
    this.controlCancel?.();
    this.remote.close();
  }
}
