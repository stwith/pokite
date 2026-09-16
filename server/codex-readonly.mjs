import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import path from "node:path";
import { codexDatabasePath } from "./codex-store.mjs";

export class CodexReadOnly extends EventEmitter {
  constructor(home) {
    super();
    this.home = home;
  }
  database() {
    if (this.db) return this.db;
    let db;
    try {
      const file = codexDatabasePath(this.home);
      if (!file) throw Error("Native store not found");
      db = new DatabaseSync(file, {
        readOnly: true,
      });
      for (const [table, columns] of Object.entries({
        threads: [
          "id",
          "rollout_path",
          "updated_at_ms",
          "project_id",
          "archived",
          "source",
        ],
        projects: ["id", "name", "position"],
        project_roots: ["project_id", "path", "position"],
      })) {
        const found = new Set(
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((x) => x.name),
        );
        if (columns.some((column) => !found.has(column)))
          throw Error("Unsupported schema");
      }
      this.db = db;
      return db;
    } catch (cause) {
      db?.close();
      throw Object.assign(
        Error("此 Codex 实例的本地数据不存在或版本不兼容，请运行 doctor 检查"),
        { status: 503, cause },
      );
    }
  }
  thread(row) {
    if (!row) throw Object.assign(Error("Session not found"), { status: 404 });
    return {
      id: row.id,
      path: row.rollout_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedAtMs: row.updated_at_ms,
      model: row.model,
      reasoningEffort: row.reasoning_effort,
      cwd: row.cwd,
      projectId: row.project_id,
      name: row.name || row.title,
      preview: row.preview,
      status: { type: "notLoaded" },
    };
  }
  async call(method, params = {}) {
    if (!["thread/read", "thread/list", "project/list"].includes(method))
      throw Object.assign(Error("Codex 已恢复为只读，桌面端写入保护已开启"), {
        status: 409,
      });
    const db = this.database();
    if (method === "thread/read")
      return {
        thread: this.thread(
          db.prepare("SELECT * FROM threads WHERE id=?").get(params.threadId),
        ),
      };
    if (method === "project/list")
      return {
        data: db
          .prepare("SELECT id,name FROM projects ORDER BY position")
          .all()
          .map((p) => ({
            ...p,
            roots: db
              .prepare(
                "SELECT path FROM project_roots WHERE project_id=? ORDER BY position",
              )
              .all(p.id),
          })),
      };
    const limit = Math.min(Number(params.limit) || 500, 1000),
      offset = Number(params.cursor) || 0;
    const rows = db
      .prepare(
        "SELECT * FROM threads WHERE archived=0 AND source IN ('cli','vscode','appServer','unknown') ORDER BY updated_at_ms DESC,id DESC LIMIT ? OFFSET ?",
      )
      .all(limit + 1, offset);
    return {
      data: rows.slice(0, limit).map((r) => this.thread(r)),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
    };
  }
  close() {
    this.db?.close();
    this.db = null;
  }
}
