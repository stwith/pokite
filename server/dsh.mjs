import { randomUUID } from "node:crypto";
import path from "node:path";
import WebSocket from "ws";
import { textContent } from "./content.mjs";

export class Dsh {
  constructor(url) {
    this.id = "dsh";
    this.base = url || process.env.DSH_URL || "http://127.0.0.1:3080";
    this.pending = new Map();
    this.statusCache = new Map();
  }
  connect() {
    if (this.socket) return;
    const socket = new WebSocket(
      this.base.replace(/^http/, "ws") + "/api/events.mux",
      { origin: this.base },
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
    const r = await fetch(this.base + "/api/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: this.base },
      body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw Error("DeepSeek Harness HTTP " + r.status);
    const x = await r.json();
    if (!x.result?.ok)
      throw Error(x.result?.error?.message || JSON.stringify(x.result));
    return x.result.value;
  }
  async projects() {
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
    const { items } = await this.call("session.list");
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
              const h = await this.call("session.history", {
                sessionId: s.sessionId,
                maxMessages: 1,
              });
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
      this.call("session.history", { sessionId: id, maxMessages: 30 }),
      this.call("session.list"),
    ]);
    const s = list.items.find((s) => s.sessionId === id);
    if (!s) throw Error("Session missing");
    const row = this.row(s, p.id);
    row.messages = this.messages(h);
    for (const { event: e } of h.events) {
      if (!e) continue;
      if (e.type === "user/message" || e.type === "turn/start") row.status = s.running ? "running" : "unknown";
      if (!s.running && e.type === "turn/end") row.status = this.endStatus(e);
      if (e.type === "turn/error" && !s.running) row.status = "failed";
    }
    row.hasMore = h.hasMore;
    row.historyCursor = h.events[0]?.event?.seq;
    if (row.status === "failed") {
      const error = h.events.map(x => x.event).filter(e => e?.type === "turn/error").at(-1)?.data;
      row.executionIssue = { retrying: false, message:
        (typeof error?.message === "string" ? error.message : typeof error?.error?.message === "string" ? error.error.message : "DeepSeek Harness 本轮执行失败，原服务未提供具体错误。" ).slice(0,4000) };
    }
    return row;
  }
  async history(id, before) {
    await this.detail(id);
    const seq = Number(before);
    if (!Number.isSafeInteger(seq) || seq < 0) throw Error("Invalid cursor");
    const h = await this.call("session.history", {
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
    const x = await this.call(
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
    return {
      id: (await this.call("session.create", { workspaceId: p.id })).sessionId,
    };
  }
  async send(id, text, requestId, model) {
    if (model) {
      const d = await this.detail(id);
      if (["running", "waiting"].includes(d.status))
        throw Object.assign(Error("请等待本轮结束后切换模型"), {
          status: 409,
          retrySafe: true,
        });
      await this.call("session.selectModel", {
        sessionId: id,
        provider: model.provider,
        model: model.model,
        ...(model.effort ? { reasoningEffort: model.effort } : {}),
      });
    }
    await this.call("session.prompt", {
      sessionId: id,
      mode: "queue",
      content: [{ type: "text", text }],
      clientTimeZone: "Asia/Shanghai",
    });
    return { accepted: true };
  }
  async answer(id, pid, body) {
    const p = this.pending.get(pid);
    if (!p || p.sessionId !== id)
      throw Object.assign(Error("审批已失效"), { status: 409 });
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
    const r = await fetch(this.base + "/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: this.base },
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
  }
}
