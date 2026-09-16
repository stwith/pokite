import fs from "node:fs/promises";
import path from "node:path";
const home = process.env.HOME;

export class Penguin {
  constructor(userHome = home) {
    this.home = userHome;
    this.watchPaths = [{ path: path.join(userHome, ".penguin/data") }];
    this.id = "penguin";
    this.agentNames = new Map();
    this.watches = new Map();
    this.pending = new Map();
    this.outcomes = new Map();
  }
  async watch(id) {
    if (this.watches.has(id)) return;
    if (this.watches.size >= 4) {
      const [old, ctrl] = this.watches.entries().next().value;
      ctrl.abort();
      this.watches.delete(old);
    }
    const controller = new AbortController();
    this.watches.set(id, controller);
    try {
      const lock = JSON.parse(
        await fs.readFile(
          path.join(this.home, ".penguin/data/server.lock"),
          "utf8",
        ),
      );
      const token = (
        await fs.readFile(
          path.join(this.home, ".penguin/data/api-token"),
          "utf8",
        )
      ).trim();
      const r = await fetch(
        `http://localhost:${lock.port}/api/sessions/${encodeURIComponent(id)}/stream`,
        {
          headers: { Authorization: "Bearer " + token },
          signal: controller.signal,
        },
      );
      if (!r.ok) throw Error("Stream unavailable");
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of r.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let n;
        while ((n = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, n);
          buffer = buffer.slice(n + 2);
          const data = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          let m;
          try {
            m = JSON.parse(data);
          } catch {
            continue;
          }
          this.receive(id, m);
        }
      }
    } catch {
    } finally {
      if (this.watches.get(id) === controller) this.watches.delete(id);
    }
  }
  receive(id, m) {
    if (m.type !== "heartbeat") this.onChange?.();
    if (m.type === "approval_request") {
      const t = m.toolCall?.payload;
      if (t?.tool_call_id)
        this.pending.set(id + ":" + t.tool_call_id, {
          id: t.tool_call_id,
          sessionId: id,
          kind: "approval",
          title: t.name || "工具调用",
          detail:
            typeof t.arguments === "string"
              ? t.arguments
              : JSON.stringify(t.arguments || {}),
        });
    }
    const resolved =
      m.type === "event_msg" && m.payload?.type === "approval_decision"
        ? m.payload.tool_call_id
        : null;
    if (resolved) this.pending.delete(id + ":" + resolved);
    if (m.type === "task_state" && m.state === "idle")
      for (const [key, p] of this.pending)
        if (p.sessionId === id) this.pending.delete(key);
  }
  async call(endpoint, body) {
    const lock = JSON.parse(
      await fs.readFile(
        path.join(this.home, ".penguin/data/server.lock"),
        "utf8",
      ),
    );
    const token = (
      await fs.readFile(path.join(this.home, ".penguin/data/api-token"), "utf8")
    ).trim();
    const r = await fetch(`http://localhost:${lock.port}/api${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const x = await r.json();
    if (!r.ok) throw Error(x.error?.message || "Penguin connection failed");
    return x;
  }
  async raw() {
    if (this.cache && Date.now() - this.cache.time < 4000)
      return this.cache.data;
    const { projects } = await this.call("/projects");
    const data = [];
    for (const p of projects) {
      const { agents } = await this.call(`/projects/${p.projectId}/agents`);
      for (const a of agents) {
        this.agentNames.set(p.projectId + ":" + a.agentId, a.name || a.agentId);
        const x = await this.call(
          `/projects/${p.projectId}/agents/${a.agentId}/sessions?category=active`,
        );
        data.push(...x.sessions);
      }
    }
    this.cache = { time: Date.now(), data };
    return data;
  }
  projectId(s) {
    return [
      s.projectId,
      s.agentId,
      this.temporary(s) ? "__temporary" : s.workspace,
    ].join("|");
  }
  temporary(s) {
    if (typeof s.workspace !== "string") return false;
    const parts = path
      .relative(
        path.join(this.home, ".penguin/data", s.projectId, "agents"),
        s.workspace,
      )
      .split(path.sep);
    return (
      parts.length === 3 &&
      parts[0] !== ".." &&
      parts[1] === "workspaces" &&
      /^tmp-[a-f0-9]+$/i.test(parts[2])
    );
  }
  async projects() {
    const rows = await this.raw();
    return [
      ...new Map(
        rows.map((s) => [
          this.projectId(s),
          {
            id: this.projectId(s),
            path: this.temporary(s) ? path.dirname(s.workspace) : s.workspace,
            name:
              (this.temporary(s)
                ? "临时会话"
                : path.basename(s.workspace) || s.workspace) +
              (s.agentId === "default_agent"
                ? ""
                : " · " +
                  (this.agentNames.get(s.projectId + ":" + s.agentId) ||
                    s.agentId)),
            temporary: this.temporary(s),
            canCreate: !this.temporary(s),
            project: s.projectId,
            agent: s.agentId,
          },
        ]),
      ).values(),
    ].sort((a, b) => Number(a.temporary) - Number(b.temporary));
  }
  row(s) {
    return {
      id: s.sessionId,
      projectId: this.projectId(s),
      workspace: s.workspace,
      title: s.title || "新会话",
      status: s.pendingApprovalCount
        ? "waiting"
        : s.status === "running"
          ? "running"
          : s.status === "idle"
            ? this.outcomes.has(s.sessionId) &&
              this.outcomes.get(s.sessionId).revision === s.lastActiveAt
              ? this.outcomes.get(s.sessionId).status
              : "idle"
            : s.status,
      updatedAt: Date.parse(s.lastActiveAt),
      revision: s.lastActiveAt,
      canReply: !s.pendingApprovalCount,
      model: s.modelId,
      pending: [...this.pending.values()].filter(
        (p) => p.sessionId === s.sessionId,
      ),
    };
  }
  async sessions(projectId) {
    return (await this.raw())
      .filter((s) => this.projectId(s) === projectId)
      .map((s) => this.row(s));
  }
  messages(h) {
    return h.messages
      .filter(
        (m) =>
          m.type === "model_msg" &&
          m.payload?.type === "text" &&
          ["user", "assistant"].includes(m.payload.role),
      )
      .map((m, i) => ({
        id: JSON.stringify(m.tracePosition) || String(i),
        role: m.payload.role,
        text: m.payload.text,
        time: m.timestamp,
      }));
  }
  async detail(id) {
    this.watch(id);
    const [{ session: s }, h] = await Promise.all([
      this.call(`/sessions/${encodeURIComponent(id)}`),
      this.call(`/sessions/${encodeURIComponent(id)}/messages?tailLimit=100`),
    ]);
    const row = this.row(s);
    row.messages = this.messages(h);
    const last = h.messages
      .filter(
        (m) =>
          m.type === "event_msg" &&
          ["request_end", "task_end", "turn_aborted"].includes(m.payload?.type),
      )
      .at(-1);
    if (row.status === "idle" && last) {
      row.status =
        last.payload.status === "completed"
          ? "completed"
          : last.payload.status === "failed"
            ? "failed"
            : "interrupted";
      this.outcomes.set(id, { revision: s.lastActiveAt, status: row.status });
    }
    row.hasMore = !!h.page?.before;
    row.historyCursor = h.page?.before;
    if (row.status === "failed") {
      const error = last?.payload?.error;
      row.executionIssue = { retrying: false, message:
        (typeof error === "string" ? error : typeof error?.message === "string" ? error.message : "Penguin 本轮执行失败，原服务未提供具体错误。").slice(0,4000) };
    }
    return row;
  }
  async history(id, before) {
    const h = await this.call(
      `/sessions/${encodeURIComponent(id)}/messages?before=${encodeURIComponent(before)}&limit=100`,
    );
    return {
      messages: this.messages(h),
      hasMore: !!h.page?.before,
      historyCursor: h.page?.before,
    };
  }
  async models(p, sessionId) {
    const catalog = await this.call(`/projects/${p.project}/models`);
    const options = catalog.models.map((m) => ({
      id: JSON.stringify([m.provider, m.modelId]),
      label: (m.displayName || m.modelId) + " · " + m.provider,
      model: m.modelId,
      provider: m.provider,
    }));
    let current = JSON.stringify([
      catalog.defaultModel.provider,
      catalog.defaultModel.modelId,
    ]);
    if (sessionId) {
      const { session } = await this.call(
        "/sessions/" + encodeURIComponent(sessionId),
      );
      current = JSON.stringify([session.provider, session.modelId]);
    }
    return {
      options,
      current,
      canSwitch: !sessionId,
      reason: sessionId
        ? "PenguinHarness 当前仅支持在新建会话时选择模型"
        : null,
    };
  }
  async create(p, model) {
    const { session } = await this.call(
      `/projects/${p.project}/agents/${p.agent}/sessions`,
      {
        workspace: p.path,
        approvalMode: "always-ask",
        client: "web",
        ...(model ? { modelId: model.model, provider: model.provider } : {}),
      },
    );
    this.cache = null;
    return { id: session.sessionId };
  }
  async send(id, text, requestId, model) {
    if (model) {
      const { session } = await this.call(
        "/sessions/" + encodeURIComponent(id),
      );
      if (
        session.provider !== model.provider ||
        session.modelId !== model.model
      )
        throw Object.assign(Error("此 Agent 不支持修改已有会话的模型"), {
          status: 409,
        });
    }
    await this.call(`/sessions/${encodeURIComponent(id)}/tasks`, {
      input: [{ type: "text", text }],
      queueIfBusy: true,
    });
    this.cache = null;
    return { accepted: true };
  }
  async answer(id, pid, body) {
    const pending = this.pending.get(id + ":" + pid);
    if (!pending) throw Object.assign(Error("审批已失效"), { status: 409 });
    const lock = JSON.parse(
      await fs.readFile(
        path.join(this.home, ".penguin/data/server.lock"),
        "utf8",
      ),
    );
    const token = (
      await fs.readFile(path.join(this.home, ".penguin/data/api-token"), "utf8")
    ).trim();
    const r = await fetch(
      `http://localhost:${lock.port}/api/sessions/${encodeURIComponent(id)}/approvals/${encodeURIComponent(pid)}`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: body.allow === true ? "allow" : "deny",
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!r.ok) throw Error("审批已失效或提交失败");
    this.pending.delete(id + ":" + pid);
    return { accepted: true };
  }
  close() {
    for (const c of this.watches.values()) c.abort();
    this.watches.clear();
  }
}
