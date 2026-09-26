import fs from "node:fs/promises";
import path from "node:path";
import { canonicalDesktopSessionId } from "./cowork-session-id.mjs";
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function cloudProjectAlias(uuid) {
  if (
    typeof uuid !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      uuid,
    )
  )
    return null;
  let number = BigInt("0x" + uuid.replaceAll("-", "")),
    encoded = "";
  while (number) {
    encoded = alphabet[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  return "claude_proj_01" + encoded.padStart(22, "1");
}
export function unifiedCloudSession(row) {
  const tags = Array.isArray(row.tags) ? row.tags : [];
  return (
    row.environment_kind === "anthropic_cloud" &&
    (tags.includes("cowork-remote") || tags.includes("product:cowork-remote"))
  );
}
const failure = (message) => Object.assign(Error(message), { status: 503 });
export class ClaudeCloudCatalog {
  constructor(root, client, { now = Date.now } = {}) {
    Object.assign(this, { root, client, now });
  }
  async get({ fresh = false, stale = false } = {}) {
    const owner = await this.client.identity(),
      scope = owner.account + ":" + owner.organization;
    if (this.cached?.scope !== scope) this.cached = null;
    if (!fresh && this.cached && this.now() - this.cached.time < 5000)
      return this.cached;
    if (!this.pending || this.pending.scope !== scope) {
      const work = this.load(owner)
        .then((result) => {
          this.cached = result;
          return result;
        })
        .finally(() => {
          if (this.pending?.work === work) this.pending = null;
        });
      this.pending = { scope, work };
    }
    if (
      stale &&
      !fresh &&
      this.cached &&
      this.now() - this.cached.time < 30000
    ) {
      void this.pending.work.catch(() => {});
      return this.cached;
    }
    return this.pending.work;
  }
  async load(owner) {
    const scope = owner.account + ":" + owner.organization;
    const request = (route) => this.client.request(route, { scope });
    const projectsWork = (async () => {
      const rows = [];
      let offset = 0;
      for (let page = 0; page < 100; page++) {
        const result = await request(
          "/api/organizations/" +
            owner.organization +
            "/projects_v2?limit=100&offset=" +
            offset,
        );
        if (!Array.isArray(result.data))
          throw failure("Claude 云端项目格式不兼容");
        rows.push(...result.data);
        if (result.pagination?.has_more !== true) return rows;
        if (!result.data.length) throw failure("Claude 项目分页未推进");
        const step = result.pagination?.limit ?? 100;
        if (
          !Number.isInteger(step) ||
          step < 1 ||
          step > 100 ||
          (result.pagination?.offset !== undefined &&
            result.pagination.offset !== offset)
        )
          throw failure("Claude 项目分页未推进");
        offset += step;
      }
      throw failure("Claude 项目过多，目录未完整读取");
    })();
    const sessionsWork = (async () => {
      const rows = [],
        seen = new Set();
      let cursor;
      for (let page = 0; page < 100; page++) {
        const result = await request(
          "/v1/code/sessions?limit=100&include_trigger_sessions=true&exclude_tags=-" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
        if (!Array.isArray(result.data))
          throw failure("Claude 云端会话格式不兼容");
        rows.push(...result.data);
        const next = result.next_cursor;
        if (!next) {
          if (result.has_more === true)
            throw failure("Claude 会话分页缺少游标");
          return rows;
        }
        if (
          typeof next !== "string" ||
          !/^[A-Za-z0-9_:-]{1,180}$/.test(next) ||
          seen.has(next)
        )
          throw failure("Claude 会话分页未推进");
        seen.add(next);
        cursor = next;
      }
      throw failure("Claude 会话过多，目录未完整读取");
    })();
    const localWork = fs
      .readFile(
        path.join(
          this.root,
          "local-agent-mode-sessions",
          owner.account,
          owner.organization,
          "remote-session-spaces.json",
        ),
        "utf8",
      )
      .then(JSON.parse)
      .catch(() => ({ entries: [] }));
    const settled = await Promise.allSettled([
      projectsWork,
      sessionsWork,
      localWork,
    ]);
    const failed = settled.find((x) => x.status === "rejected");
    if (failed) throw failed.reason;
    const [cloudProjects, cloudRows, local] = settled.map((x) => x.value);
    const entries = new Map(
      (local.entries || []).map((e) => [
        canonicalDesktopSessionId(e.sessionId),
        e,
      ]),
    );
    const projects = cloudProjects
      .filter((p) => !p.archived_at)
      .map((p) => ({
        id: "cloud:" + scope + ":" + p.uuid,
        name: p.name || "未命名项目",
        path: "",
        cloudId: cloudProjectAlias(p.uuid),
        uuid: p.uuid,
        virtual: true,
        canCreate: false,
        readOnly: true,
        aliases: [],
      }));
    const byCloud = new Map(
      projects.flatMap((p) => [
        [p.cloudId, p],
        [p.uuid, p],
      ]),
    );
    const ungrouped = {
      id: "cloud:" + scope + ":ungrouped",
      name: "未分组",
      path: "",
      virtual: true,
      canCreate: false,
      readOnly: true,
      aliases: [],
    };
    const rows = [];
    for (const row of cloudRows) {
      const id = canonicalDesktopSessionId(row.id),
        entry = entries.get(id);
      if (!id || (!unifiedCloudSession(row) && !entry)) continue;
      let project = row.chat_project_id
        ? byCloud.get(row.chat_project_id)
        : ungrouped;
      if (!project) {
        // Never mislabel an unknown project as a named one or drop its sessions.
        const key = "cloud:" + scope + ":" + row.chat_project_id;
        project = projects.find((p) => p.id === key);
        if (!project) {
          project = {
            id: key,
            name: "未命名项目",
            path: "",
            virtual: true,
            canCreate: false,
            readOnly: true,
            aliases: [],
          };
          projects.push(project);
        }
      }
      if (project === ungrouped && !projects.includes(ungrouped))
        projects.push(ungrouped);
      if (entry?.spaceId) {
        const alias = [
          "local-agent-mode-sessions",
          owner.account,
          owner.organization,
          entry.spaceId,
        ]
          .map(encodeURIComponent)
          .join(":");
        if (!project.aliases.includes(alias)) project.aliases.push(alias);
      }
      rows.push({
        native: row,
        id: ["remote", owner.account, owner.organization, id].join(":"),
        remoteId: id,
        scope,
        projectId: project.id,
        projectName: project.name,
        workspace: project.path,
      });
    }
    const after = await this.client.identity();
    if (after.account + ":" + after.organization !== scope)
      throw Object.assign(Error("Claude 账号已切换，请刷新会话。"), {
        status: 409,
      });
    return { scope, time: this.now(), projects, rows };
  }
  clear() {
    this.cached = null;
  }
}
