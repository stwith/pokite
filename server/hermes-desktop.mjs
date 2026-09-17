import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  discoverHermesBackends,
  HermesDesktopClient,
} from "./hermes-desktop-client.mjs";

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function decode(value) {
  try {
    const result = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      result.every((v) => typeof v === "string")
    )
      return result;
  } catch {}
  throw Object.assign(new Error("Invalid Hermes identifier"), { status: 400 });
}
const text = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((p) => p?.type === "text")
          .map((p) => p.text || "")
          .join("\n")
      : "";

export class HermesDesktop {
  constructor(
    home,
    { discover = discoverHermesBackends, Client = HermesDesktopClient } = {},
  ) {
    this.home = home;
    this.discover = discover;
    this.Client = Client;
    this.clients = new Map();
    this.created = new Map();
    this.watchPaths = [{ path: home, recursive: true }];
  }
  profiles() {
    const root = path.join(this.home, "profiles");
    const names = fs.existsSync(root)
      ? fs
          .readdirSync(root, { withFileTypes: true })
          .filter((x) => x.isDirectory())
          .map((x) => x.name)
      : [];
    return ["default", ...names.filter((x) => /^[a-zA-Z0-9_-]+$/.test(x))];
  }
  rows() {
    const rows = [];
    for (const profile of this.profiles()) {
      const file = path.join(
        this.home,
        profile === "default" ? "" : "profiles/" + profile,
        "state.db",
      );
      if (!fs.existsSync(file)) continue;
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        // Metadata only: never parse entire transcripts to populate navigation.
        for (const row of db
          .prepare(
            "SELECT id, title, cwd, model, started_at, last_activity_at AS last_active, message_count, end_reason FROM sessions WHERE source = 'desktop' AND COALESCE(archived,0)=0 AND COALESCE(hidden,0)=0 ORDER BY COALESCE(last_activity_at,started_at) DESC",
          )
          .all()) {
          rows.push({ ...row, profile });
        }
      } finally {
        db.close();
      }
    }
    return rows;
  }
  async connections() {
    if (this.discovering) return this.discovering;
    if (Date.now() < (this.discoveredUntil || 0))
      return [...this.clients.values()];
    this.discovering = (async () => {
      const endpoints = await this.discover(this.home);
      const current = new Set(endpoints.map((e) => e.pid));
      for (const [pid, client] of this.clients)
        if (!current.has(pid)) {
          client.close();
          this.clients.delete(pid);
        }
      for (const endpoint of endpoints)
        if (!this.clients.has(endpoint.pid)) {
          const client = new this.Client(endpoint);
          this.clients.set(endpoint.pid, client);
        }
      this.discoveredUntil = Date.now() + 2000;
      return [...this.clients.values()];
    })().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }
  async live() {
    const clients = await this.connections();
    const rows = [];
    this.resumeClients = new Map();
    for (const client of clients) {
      let result;
      try {
        result = await client.get("/api/plugins/pokite/sessions");
      } catch (error) {
        if (error.status === 404) continue;
        throw error;
      }
      if (![1, 2].includes(result.version)) throw new Error("Hermes 本地插件版本不兼容");
      if (result.version === 2 && result.can_resume) this.resumeClients.set(client.endpoint.profile, client);
      for (const session of result.sessions) rows.push({ ...session, client });
    }
    return rows;
  }
  subscribeChanges(notify) {
    // Native in-memory progress need not change the session database.
    const timer = setInterval(notify, 2000);
    timer.unref?.();
    return () => clearInterval(timer);
  }
  projectId(row) {
    return encode([row.profile, row.cwd || ""]);
  }
  resumeClient(profile) {
    return this.resumeClients?.get(profile) || this.resumeClients?.get("default");
  }
  row(row, live) {
    const active = live.find((s) => s.session_key === row.id);
    const failure = active?.inflight?.error;
    const writable = !!active || !!this.resumeClient(row.profile);
    return {
      id: encode([row.profile, row.id]),
      projectId: this.projectId(row),
      title: row.title || "未命名会话",
      model: row.model,
      status: failure
        ? "failed"
        : ["working", "starting"].includes(active?.status)
          ? "running"
          : active?.status === "waiting"
            ? "waiting"
            : "idle",
      updatedAt: new Date(
        (row.last_active || row.started_at || 0) * 1000,
      ).toISOString(),
      revision:
        String(row.message_count) + ":" + (row.last_active || row.started_at),
      canReply: writable,
      readOnly: !writable,
      ...(!writable
        ? {
            readOnlyReason:
              "请打开 Hermes Desktop 并确认本地共享插件已更新。",
          }
        : {}),
      ...(failure
        ? { executionIssue: { message: failure, retrying: false } }
        : {}),
    };
  }
  async projects() {
    return [
      ...new Map(
        this.rows().map((row) => [
          this.projectId(row),
          {
            id: this.projectId(row),
            name:
              (row.profile === "default" ? "" : row.profile + " · ") +
              (row.cwd ? path.basename(row.cwd) : "未分配项目"),
            path: row.cwd || "",
            canCreate: !!row.cwd,
          },
        ]),
      ).values(),
    ];
  }
  async sessions(projectId) {
    const live = await this.live();
    return this.rows()
      .filter((row) => this.projectId(row) === projectId)
      .map((row) => this.row(row, live));
  }
  find(id) {
    const [profile, storedId] = decode(id);
    const row =
      this.rows().find((r) => r.profile === profile && r.id === storedId) ||
      this.created.get(id);
    if (!row)
      throw Object.assign(new Error("Hermes session not found"), {
        status: 404,
      });
    return row;
  }
  async reader(profile) {
    const clients = await this.connections();
    const client =
      clients.find((c) => c.endpoint.profile === profile) ||
      clients.find((c) => c.endpoint.profile === "default");
    if (!client)
      throw Object.assign(new Error("请先打开 Hermes Desktop。"), {
        delivery: "not-sent",
      });
    return client;
  }
  async page(row, offset = 0) {
    const client = await this.reader(row.profile);
    const result = await client.get(
      `/api/sessions/${encodeURIComponent(row.id)}/messages?` +
        new URLSearchParams({
          profile: row.profile,
          limit: "60",
          offset: String(offset),
          order: "latest",
        }),
    );
    return {
      messages: result.messages
        .filter(
          (m) =>
            ["user", "assistant"].includes(m.role) &&
            m.display_kind !== "hidden",
        )
        .map((m) => ({
          id: String(m.id),
          role: m.role,
          text: text(m.content),
          time: m.timestamp
            ? new Date(m.timestamp * 1000).toISOString()
            : undefined,
        }))
        .filter((m) => m.text),
      hasMore: result.messages.length === 60,
      historyCursor: String(offset + 60),
    };
  }
  async detail(id) {
    const row = this.find(id);
    const [live, history] = await Promise.all([this.live(), this.page(row)]);
    const active = live.find((s) => s.session_key === row.id);
    const turn = active?.inflight;
    if (turn && ["working", "starting"].includes(active.status)) {
      if (
        turn.user &&
        !history.messages.some((m) => m.role === "user" && m.text === turn.user)
      )
        history.messages.push({
          id: "live-user-" + active.id,
          role: "user",
          text: turn.user,
        });
      if (turn.assistant)
        history.messages.push({
          id: "live-assistant-" + active.id,
          role: "assistant",
          text: turn.assistant,
        });
    }
    const progress = active?.progress;
    const executionProgress = ["working", "starting"].includes(active?.status)
      ? progress === "compacting" ? "正在压缩历史上下文，完成后继续回复"
        : progress === "starting" || active.status === "starting" ? "正在恢复会话并准备模型"
          : turn?.assistant ? "正在生成回复" : "正在等待模型响应"
      : undefined;
    return { ...this.row(row, live), ...history, executionProgress, pending: [] };
  }
  async history(id, cursor) {
    if (!/^\d+$/.test(cursor) || Number(cursor) > 1000000)
      throw new Error("Invalid history cursor");
    return this.page(this.find(id), Number(cursor));
  }
  async models() {
    return {
      options: [],
      canSwitch: false,
      reason: "沿用 Hermes Desktop 当前模型",
    };
  }
  async send(id, message) {
    const row = this.find(id);
    const active = (await this.live()).find((s) => s.session_key === row.id);
    // The plugin dispatches using the original Desktop transport. Direct RPC
    // prompt.submit also steals ownership, even without session.resume.
    const client = active?.client || this.resumeClient(row.profile);
    if (!client)
      throw Object.assign(new Error("请先在 Hermes Desktop 打开此会话。"), {
        delivery: "not-sent",
      });
    if (["working", "starting", "waiting"].includes(active?.status))
      throw Object.assign(new Error("等待 Hermes 当前任务结束"), {
        retrySafe: true,
      });
    const result = await client.post("/api/plugins/pokite/send", {
      session_id: active?.id || row.id,
      ...(!active ? { stored_session_id: row.id, profile: row.profile } : {}),
      text: message,
    });
    this.onChange?.();
    return { accepted: true, status: result.status };
  }
  async create(project) {
    const [profile, cwd] = decode(project.id);
    if (
      !(await this.projects()).some((p) => p.id === project.id && p.canCreate)
    )
      throw new Error("请选择已有项目");
    const client = await this.reader(profile);
    const result = await client.post("/api/plugins/pokite/create", {
      cwd,
      profile,
    });
    const id = encode([profile, result.stored_session_id]);
    this.created.set(id, {
      id: result.stored_session_id,
      profile,
      cwd,
      started_at: Date.now() / 1000,
      message_count: 0,
    });
    return { id, projectId: project.id };
  }
  close() {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }
}
