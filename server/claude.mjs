import {
  query,
  listSessions,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { userFacingText } from "./messages.mjs";
import { WeightedCache } from "./weighted-cache.mjs";
import { desktopCodeSessionIds } from "./claude-session-ownership.mjs";

const plain = (c) =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c
          .filter((b) => b.type === "text")
          .map((b) => b.text || "")
          .join("\n")
      : "";
export class Claude {
  constructor(sdk = { query, listSessions, getSessionMessages }, options = {}) {
    this.sdk = sdk;
    this.id = "claude";
    this.desktopRoot = options.desktopRoot || path.join(process.env.HOME, "Library/Application Support/Claude");
    this.root =
      options.root ||
      process.env.CLAUDE_CONFIG_DIR ||
      path.join(process.env.HOME, ".claude");
    this.watchPaths = [
      { path: path.join(this.root, "projects"), recursive: true },
    ];
    this.file =
      options.stateFile ||
      new URL("../.local/claude-state.json", import.meta.url);
    this.tempFile = new URL(this.file.href + ".tmp");
    this.states = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : {};
    this.jobs = new Map();
    this.executions = new Set();
    this.pending = new Map();
    this.historyCache = new WeightedCache({
      maxWeight: options.historyCacheBytes ?? 16 * 1024 * 1024,
      weigh: (entry) => entry.weight,
    });
    for (const s of Object.values(this.states))
      if (["running", "waiting"].includes(s.status)) s.status = "interrupted";
  }
  save() {
    fs.writeFileSync(this.tempFile, JSON.stringify(this.states), {
      mode: 0o600,
    });
    fs.renameSync(this.tempFile, this.file);
  }
  options(cwd) {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: this.root };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    return {
      cwd,
      ...(process.env.CLAUDE_BIN
        ? { pathToClaudeCodeExecutable: process.env.CLAUDE_BIN }
        : {}),
      env,
      settingSources: ["user", "project", "local"],
      permissionMode: "default",
    };
  }
  async raw() {
    const owned = await desktopCodeSessionIds(this.desktopRoot);
    return (await this.sdk.listSessions({ limit: 1000 })).filter((s) => !owned.has(s.sessionId));
  }
  async projects() {
    let known = {};
    try {
      known =
        JSON.parse(
          await fsp.readFile(
            path.join(process.env.HOME, ".claude.json"),
            "utf8",
          ),
        ).projects || {};
    } catch {}
    const rows = await this.raw();
    const dirs = [
      ...new Set([
        ...rows.map((s) => s.cwd).filter(Boolean),
        ...Object.keys(known),
        ...Object.values(this.states).map((s) => s.cwd),
      ]),
    ];
    const result = [];
    for (const cwd of dirs)
      if ((await fsp.stat(cwd).catch(() => null))?.isDirectory())
        result.push({ id: cwd, path: cwd, name: path.basename(cwd) });
    return result;
  }
  async info(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw Object.assign(Error("Invalid Claude session"), { status: 400 });
    if ((await desktopCodeSessionIds(this.desktopRoot)).has(id))
      throw Object.assign(Error("此会话属于 Claude Desktop，请从 Claude Desktop 的 Code 项目进入。独立 CLI 不能接管此会话。"), { status: 409, delivery: "not-sent" });
    const native = (await this.raw()).find((s) => s.sessionId === id);
    if (native) return native;
    const s = this.states[id];
    if (s)
      return {
        sessionId: id,
        cwd: s.cwd,
        summary: s.title,
        lastModified: s.updatedAt,
        fileSize: 0,
      };
    throw Object.assign(Error("Claude session not found"), { status: 404 });
  }
  async messages(info) {
    const revision = String(info.lastModified) + ":" + info.fileSize;
    const cache = this.historyCache.get(info.sessionId);
    if (cache?.revision === revision) return cache.messages;
    const messages = await this.sdk.getSessionMessages(info.sessionId, {
      dir: info.cwd,
    });
    this.historyCache.set(info.sessionId, {
      revision,
      messages,
      weight: JSON.stringify(messages).length * 2,
    });
    return messages;
  }
  render(messages) {
    return messages
      .filter(
        (m) => ["user", "assistant"].includes(m.type) && !m.parent_tool_use_id,
      )
      .flatMap((m) => {
        const raw = plain(m.message?.content);
        const text = m.type === "user" ? userFacingText(raw) : raw;
        if (!text) return [];
        return [{ id: m.uuid, role: m.type, text, time: m.timestamp }];
      });
  }
  async detail(id) {
    const info = await this.info(id);
    const raw = await this.messages(info);
    const state = this.states[id];
    const pending = [...this.pending.values()]
      .filter((p) => p.view.sessionId === id)
      .map((p) => p.view);
    const live = this.jobs.get(id);
    const last = raw.at(-1);
    let status = ["end_turn", "stop_sequence"].includes(
      last?.message?.stop_reason,
    )
      ? "completed"
      : last
        ? "unknown"
        : "idle";
    if (
      last?.message?.model === "<synthetic>" &&
      plain(last.message.content).startsWith("API Error:")
    )
      status = "failed";
    if (live) status = pending.length ? "waiting" : "running";
    else if (
      state &&
      (!info.fileSize ||
        state.revision === String(info.lastModified) + ":" + info.fileSize)
    )
      status = state.status;
    const messages = this.render(raw);
    if (
      state?.error &&
      status === "failed" &&
      !(
        messages.at(-1)?.role === "assistant" &&
        state.error.includes(messages.at(-1).text)
      )
    )
      messages.push({
        id: "failure:" + state.updatedAt,
        role: "assistant",
        text: "执行失败：" + state.error,
        time: new Date(state.updatedAt).toISOString(),
      });
    return {
      id,
      projectId: info.cwd,
      title: info.customTitle || info.summary || state?.title || "新会话",
      status,
      executionIssue: live && state?.retryIssue ? state.retryIssue :
        status === "failed" ? { message: state?.error || "Claude 执行失败，请查看会话中的错误记录。", retrying: false } : null,
      updatedAt: Math.max(info.lastModified, state?.updatedAt || 0),
      revision:
        String(info.lastModified) +
        ":" +
        info.fileSize +
        ":" +
        (state?.updatedAt || 0),
      canReply: !["running", "waiting", "unknown"].includes(status),
      model: live
        ? state?.model
        : raw
            .filter(
              (m) =>
                m.type === "assistant" && m.message?.model !== "<synthetic>",
            )
            .at(-1)?.message?.model ||
          state?.model ||
          null,
      messages: messages.slice(-80),
      hasMore: messages.length > 80,
      historyCursor: messages.length > 80 ? messages.slice(-80)[0].id : null,
      pending,
    };
  }
  async sessions(projectId) {
    const owned = await desktopCodeSessionIds(this.desktopRoot);
    const native = (await this.raw()).filter((s) => s.cwd === projectId);
    const ids = [
      ...new Set([
        ...native.map((s) => s.sessionId),
        ...Object.entries(this.states)
          .filter(([, s]) => s.cwd === projectId)
          .map(([id]) => id),
      ]),
    ];
    const rows = ids.filter((id) => !owned.has(id)).map((id) => {
      const n = native.find((s) => s.sessionId === id),
        s = this.states[id];
      return {
        id,
        projectId,
        title: n?.customTitle || n?.summary || s?.title || "新会话",
        status: this.jobs.has(id)
          ? "running"
          : !n?.fileSize ||
              s?.revision === String(n?.lastModified) + ":" + n?.fileSize
            ? s?.status || "unknown"
            : "unknown",
        updatedAt: n?.lastModified || s?.updatedAt || 0,
        revision:
          String(n?.lastModified || s?.updatedAt || 0) +
          ":" +
          (n?.fileSize || 0) +
          ":" +
          (s?.updatedAt || 0),
        canReply: true,
      };
    });
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ messages, ...s }) => s);
  }
  async history(id, before) {
    const info = await this.info(id);
    const rows = this.render(await this.messages(info));
    const index = rows.findIndex((m) => m.id === before);
    if (index < 0)
      throw Object.assign(Error("History cursor expired"), { status: 400 });
    const items = rows.slice(Math.max(0, index - 80), index);
    return {
      messages: items,
      hasMore: index > 80,
      historyCursor: items[0]?.id,
    };
  }
  async models(p, id) {
    if (!this.catalog || Date.now() - this.catalog.time > 60000) {
      const controller = new AbortController();
      async function* idle() {
        if (!controller.signal.aborted)
          await new Promise((r) =>
            controller.signal.addEventListener("abort", r, { once: true }),
          );
      }
      const q = this.sdk.query({
        prompt: idle(),
        options: {
          ...this.options(process.env.HOME),
          persistSession: false,
          settings: { disableAllHooks: true },
          abortController: controller,
        },
      });
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        this.catalog = {
          time: Date.now(),
          options: (await q.supportedModels()).map((m) => ({
            id: m.value,
            model: m.value,
            label: m.displayName,
            resolvedModel: m.resolvedModel,
            efforts: m.supportedEffortLevels || [],
          })),
        };
      } finally {
        clearTimeout(timer);
        controller.abort();
        q.close();
      }
    }
    const current = id ? (await this.detail(id)).model : null;
    const options = this.catalog.options;
    return {
      options,
      current:
        options.find((m) => m.id === current || m.resolvedModel === current)
          ?.id || null,
      canSwitch: true,
    };
  }
  async create(project, model) {
    const id = randomUUID();
    this.states[id] = {
      cwd: project.path,
      title: "新会话",
      updatedAt: Date.now(),
      status: "idle",
      isNew: true,
      model: model?.model,
    };
    this.save();
    return { id };
  }
  async send(id, text, requestId, model) {
    const d = await this.detail(id);
    if (!d.canReply)
      throw Object.assign(
        Error("Claude 会话正在执行或状态尚未确认，请等待结束后回复"),
        { status: 409, retrySafe: true },
      );
    const prev = this.states[id];
    const state = {
      ...prev,
      cwd: d.projectId,
      title: prev?.title === "新会话" ? text.slice(0, 90) : d.title,
      updatedAt: Date.now(),
      status: "running",
      model: model?.model || prev?.model,
      error: null,
      retryIssue: null,
    };
    this.states[id] = state;
    const controller = new AbortController();
    this.jobs.set(id, { controller });
    this.save();
    const execution = this.drive(id, text, model, controller);
    this.executions.add(execution);
    execution.then(
      () => {
        this.executions.delete(execution);
        this.persistenceError = null;
      },
      (error) => {
        this.executions.delete(execution);
        this.persistenceError = error;
      },
    );
    return { accepted: true };
  }
  async drive(id, text, model, controller) {
    const state = this.states[id];
    let handle;
    try {
      handle = this.sdk.query({
        prompt: text,
        options: {
          ...this.options(state.cwd),
          abortController: controller,
          ...(state.isNew ? { sessionId: id } : { resume: id }),
          ...(model ? { model: model.model } : {}),
          ...(model?.effort ? { effort: model.effort } : {}),
          canUseTool: (name, input, opts) => this.ask(id, name, input, opts),
        },
      });
      for await (const message of handle) {
        if (message.parent_tool_use_id) continue;
        if (message.session_id && message.session_id !== id)
          throw Error("Claude session identity changed; execution stopped");
        if (message.type === "system" && message.subtype === "api_retry") {
          state.retryIssue = { retrying: true, message:
            `${message.error_status ? "HTTP " + message.error_status : "网络连接异常"}，正在重试 ${message.attempt}/${message.max_retries}，约 ${Math.ceil(message.retry_delay_ms / 1000)} 秒后再次尝试。` };
          state.updatedAt = Date.now();
          this.onChange?.();
        }
        if (message.type === "assistant" || message.type === "result") {
          state.retryIssue = null;
          state.updatedAt = Date.now();
          this.onChange?.();
        }
        if (message.type === "system" && message.subtype === "init") {
          state.model = message.model;
          state.isNew = false;
        }
        if (message.type === "result") {
          state.status = message.is_error ? "failed" : "completed";
          state.error = message.is_error
            ? (message.errors || [message.result || message.subtype])
                .join("\n")
                .slice(0, 2000)
            : null;
        }
      }
      if (state.status === "running") state.status = "interrupted";
    } catch (e) {
      state.status = controller.signal.aborted ? "interrupted" : "failed";
      state.error = e.message.slice(0, 2000);
    } finally {
      handle?.close();
      this.jobs.delete(id);
      for (const [pid, p] of this.pending)
        if (p.view.sessionId === id)
          p.settle({ behavior: "deny", message: "Session ended" });
      state.updatedAt = Date.now();
      const info = (await this.raw().catch(() => [])).find(
        (s) => s.sessionId === id,
      );
      if (info)
        state.revision = String(info.lastModified) + ":" + info.fileSize;
      this.historyCache.delete(id);
      this.save();
    }
  }
  ask(id, name, input, opts) {
    const pid = randomUUID();
    return new Promise((resolve) => {
      const questions =
        name === "AskUserQuestion"
          ? (input.questions || []).map((q, i) => ({ ...q, id: String(i) }))
          : null;
      const view = {
        id: pid,
        sessionId: id,
        kind: questions ? "question" : "approval",
        questions,
        title: opts.title || name,
        detail: JSON.stringify(input, null, 2),
      };
      const aborted = () =>
        settle({ behavior: "deny", message: "Request cancelled" });
      const settle = (result) => {
        opts.signal.removeEventListener("abort", aborted);
        this.pending.delete(pid);
        resolve(result);
      };
      this.pending.set(pid, { view, input, settle });
      opts.signal.addEventListener("abort", aborted, { once: true });
      if (opts.signal.aborted) aborted();
    });
  }
  async answer(id, pid, body) {
    const p = this.pending.get(pid);
    if (!p || p.view.sessionId !== id)
      throw Object.assign(Error("审批已失效"), { status: 409 });
    if (p.view.kind === "question") {
      const answers = {};
      for (const [i, q] of p.input.questions.entries())
        answers[q.question] = String(body.answers?.[String(i)] || "");
      p.settle({ behavior: "allow", updatedInput: { ...p.input, answers } });
    } else
      p.settle(
        body.allow === true
          ? { behavior: "allow", updatedInput: p.input }
          : { behavior: "deny", message: "User declined" },
      );
    return { accepted: true };
  }
  async close() {
    for (const j of this.jobs.values()) j.controller.abort();
    for (const p of this.pending.values())
      p.settle({ behavior: "deny", message: "Connection closed" });
    await Promise.allSettled([...this.executions]);
    this.historyCache.clear();
    if (this.persistenceError) throw this.persistenceError;
  }
}
