import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { userFacingText } from "./messages.mjs";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { WeightedCache } from "./weighted-cache.mjs";

export class ClaudeDesktop {
  constructor(
    root = path.join(process.env.HOME, "Library/Application Support/Claude"),
    options = {},
  ) {
    this.root = root;
    this.readOnly = true;
    this.emptyState =
      "此账号暂无可读取的本地 Code/Cowork 会话；云端 Chat 尚未接入。";
    this.watchPaths = ["claude-code-sessions", "local-agent-mode-sessions"].map(
      (name) => ({ path: path.join(root, name), recursive: true }),
    );
    this.watchPaths.push({
      path: path.join(root, "config.json"),
      recursive: false,
    });
    this.cache = null;
    this.details = new WeightedCache({
      maxEntries: 30,
      maxWeight: options.historyCacheBytes ?? 16 * 1024 * 1024,
      weigh: (entry) =>
        512 +
        entry.messages.reduce((bytes, m) => bytes + 256 + m.text.length * 2, 0),
    });
  }
  async raw() {
    // Desktop persists this identifier on account changes; never fall back to
    // scanning other accounts when it is absent or has no local history.
    const config = await fs
      .readFile(path.join(this.root, "config.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    const account = config?.lastKnownAccountUuid;
    if (typeof account !== "string" || !/^[a-zA-Z0-9_-]+$/.test(account)) {
      this.cache = null;
      this.details.clear();
      throw Object.assign(
        Error(
          "无法确认 Claude Desktop 账号，请在桌面端登录后刷新；未读取其他账号历史。",
        ),
        { status: 409 },
      );
    }
    if (this.cache?.account !== account) this.details.clear();
    const rows = [];
    const organizations = new Set();
    for (const kind of ["claude-code-sessions", "local-agent-mode-sessions"]) {
      for (const e of await fs
        .readdir(path.join(this.root, kind, account), { withFileTypes: true })
        .catch(() => [])) {
        if (e.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(e.name))
          organizations.add(e.name);
      }
    }
    if (organizations.size > 1) {
      this.cache = null;
      this.details.clear();
      throw Object.assign(
        Error(
          "Claude Desktop 当前账号存在多个组织的本地记录，尚无法确认当前组织，已暂停混合展示。",
        ),
        { status: 409 },
      );
    }
    const organization = [...organizations][0] || "";
    if (
      this.cache?.account === account &&
      this.cache.organization === organization &&
      Date.now() - this.cache.time < 5000
    )
      return this.cache.rows;
    if (this.cache?.organization !== organization) this.details.clear();
    const coworkRoot = path.join(
      this.root,
      "local-agent-mode-sessions",
      account,
      organization,
    );
    const spaceFile = organization
      ? await fs
          .readFile(path.join(coworkRoot, "spaces.json"), "utf8")
          .then(JSON.parse)
          .catch(() => null)
      : null;
    const spaces = new Map(
      (Array.isArray(spaceFile?.spaces) ? spaceFile.spaces : [])
        .filter((s) => typeof s?.id === "string" && typeof s.name === "string")
        .map((s) => [s.id, s]),
    );
    const remoteFile = organization
      ? await fs
          .readFile(path.join(coworkRoot, "remote-session-spaces.json"), "utf8")
          .then(JSON.parse)
          .catch(() => null)
      : null;
    const remoteEntries = Array.isArray(remoteFile?.entries)
      ? remoteFile.entries
      : [];
    const makeProjectId = (kind, org, group) =>
      [kind, account, org, group].map(encodeURIComponent).join(":");
    for (const kind of ["claude-code-sessions", "local-agent-mode-sessions"]) {
      const walk = async (dir, depth = 0) => {
        for (const entry of await fs
          .readdir(dir, { withFileTypes: true })
          .catch(() => [])) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory() && depth < 1) await walk(file, depth + 1);
          else if (
            depth === 1 &&
            entry.isFile() &&
            /^local_.*\.json$/.test(entry.name)
          ) {
            try {
              const s = JSON.parse(await fs.readFile(file, "utf8"));
              if (!s.sessionId || s.isArchived) continue;
              if (!/^[a-zA-Z0-9_-]+$/.test(s.sessionId)) continue;
              const org = path
                .relative(path.join(this.root, kind, account), file)
                .split(path.sep)[0];
              const code = kind === "claude-code-sessions";
              const workspace = code ? s.originCwd || s.cwd : undefined;
              const group = code
                ? workspace || "ungrouped"
                : s.spaceId || "ungrouped";
              const projectId = makeProjectId(kind, org, group);
              const projectName = code
                ? workspace
                  ? path.basename(workspace)
                  : "Code · 未分组"
                : s.spaceId
                  ? spaces.get(s.spaceId)?.name || "Cowork · 项目 " + s.spaceId
                  : "Cowork · 未分组";
              rows.push({
                id: s.sessionId,
                projectId,
                projectName,
                title: s.title || "未命名会话",
                status: "unknown",
                updatedAt: s.lastActivityAt || s.createdAt || 0,
                revision: String(s.lastActivityAt || s.createdAt || 0),
                model: s.model,
                canReply: false,
                readOnly: true,
                workspace,
                pending: [],
                audit: path.join(dir, s.sessionId, "audit.jsonl"),
                cliSessionId: s.cliSessionId,
                ...(code
                  ? {
                      codeLocalId: s.sessionId,
                      codeBridgeIds: Array.isArray(s.bridgeSessionIds)
                        ? s.bridgeSessionIds
                        : [],
                      codeSpawnBridgeId: s.remoteControlSpawn?.ccrSessionId,
                      codeRemoteEnabled: s.remoteControlUserEnabled,
                    }
                  : {}),
              });
            } catch {}
          }
        }
      };
      await walk(path.join(this.root, kind, account));
    }
    const projects = [...spaces.values()].map((s) => ({
      id: makeProjectId("local-agent-mode-sessions", organization, s.id),
      name: s.name,
      path:
        Array.isArray(s.folders) && typeof s.folders[0]?.path === "string"
          ? s.folders[0].path
          : "",
      canCreate: false,
      readOnly: true,
      emptyState: remoteEntries.some((e) => e?.spaceId === s.id)
        ? "已找到此项目的远程会话关联；远程正文和发送尚未接入。"
        : "此项目暂无可读取的本地会话。",
    }));
    this.cache = { time: Date.now(), rows, account, organization, projects };
    return rows;
  }
  async projects() {
    const rows = await this.raw();
    const localProjects = [
      ...new Map(rows.map((s) => [s.projectId, s])).values(),
    ].map((s) => ({
      id: s.projectId,
      path: s.workspace || "",
      name: s.projectName,
      canCreate: false,
      readOnly: true,
    }));
    return [
      ...new Map(
        [...localProjects, ...(this.cache?.projects || [])].map((p) => [
          p.id,
          p,
        ]),
      ).values(),
    ];
  }
  async sessions(id) {
    return (await this.raw())
      .filter((s) => s.projectId === id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ audit, cliSessionId, ...s }) => s);
  }
  async detail(id) {
    return (await this.loadDetail(id)).result;
  }
  async loadDetail(id, rows) {
    const s = (rows || (await this.raw())).find((s) => s.id === id);
    if (!s) throw Error("Desktop session missing");
    const messages = [];
    let status = "unknown";
    const st = await fs.stat(s.audit).catch(() => null);
    const revision = st
      ? [st.ino, st.size, st.mtimeMs, st.ctimeMs].join(":")
      : s.revision;
    const cached = this.details.get(id);
    if (cached?.revision === revision) return cached;
    if (st) {
      for await (const line of createInterface({
        input: createReadStream(s.audit),
        crlfDelay: Infinity,
      })) {
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.type === "result") status = m.is_error ? "failed" : "completed";
        if (!["user", "assistant"].includes(m.type) || m.parent_tool_use_id)
          continue;
        const content = m.message?.content;
        const raw =
          typeof content === "string"
            ? content
            : (content || [])
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");
        const text = m.type === "user" ? userFacingText(raw) : raw;
        if (text)
          messages.push({
            id: m.uuid || String(messages.length),
            role: m.type,
            text,
            time: m._audit_timestamp,
          });
      }
    } else if (s.projectId.startsWith("claude-code") && s.cliSessionId) {
      for (const m of await getSessionMessages(s.cliSessionId, {
        dir: s.workspace,
      }).catch(() => [])) {
        if (!["user", "assistant"].includes(m.type) || m.parent_tool_use_id)
          continue;
        const c = m.message?.content,
          raw =
            typeof c === "string"
              ? c
              : (c || [])
                  .filter((x) => x.type === "text")
                  .map((x) => x.text)
                  .join("\n");
        const text = m.type === "user" ? userFacingText(raw) : raw;
        if (text)
          messages.push({ id: m.uuid, role: m.type, text, time: m.timestamp });
        if (m.type === "user") status = "unknown";
        if (m.message?.stop_reason === "end_turn") status = "completed";
      }
    }
    const { audit, cliSessionId, ...row } = s;
    const result = {
      ...row,
      status,
      messages: messages.slice(-80),
      hasMore: messages.length > 80,
      historyCursor: messages.slice(-80)[0]?.id,
      readOnlyReason: messages.length
        ? "桌面会话记录；当前未接入 Desktop 的发送接口。"
        : "已找到桌面会话标题，但本机没有可读取的对话正文。",
    };
    const entry = { revision, result, messages };
    this.details.set(id, entry);
    return entry;
  }
  async history(id, before, sourceRows) {
    const rows = (await this.loadDetail(id, sourceRows)).messages,
      i = rows.findIndex((m) => m.id === before);
    if (i < 0) throw Error("History cursor expired");
    const messages = rows.slice(Math.max(0, i - 80), i);
    return { messages, hasMore: i > 80, historyCursor: messages[0]?.id };
  }
  async models() {
    return {
      options: [],
      current: null,
      canSwitch: false,
      reason: "桌面会话只读",
    };
  }
}
