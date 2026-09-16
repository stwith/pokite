import fs from "node:fs";
import { createHash } from "node:crypto";
export class Operations {
  constructor(file) {
    this.file = file;
    this.pending = new Map();
    this.records = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : {};
  }
  save() {
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.records), {
      mode: 0o600,
    });
    fs.renameSync(this.file + ".tmp", this.file);
  }
  async run(id, input, fn) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{12,100}$/.test(id))
      throw Object.assign(Error("Missing request id"), { status: 400 });
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const old = this.records[id];
    if (old) {
      if (old.hash !== hash)
        throw Object.assign(Error("Request id reused"), { status: 409 });
      if (this.pending.has(id)) return this.pending.get(id);
      if (old.state === "done") return old.result;
      throw Object.assign(
        Error(old.error || "上次提交结果未确认，请先检查会话内容。"),
        { status: 409 },
      );
    }
    this.records[id] = { hash, state: "pending" };
    try {
      this.save();
    } catch (cause) {
      delete this.records[id];
      throw Object.assign(
        Error("发送回执未能保存，消息尚未提交，请恢复磁盘后重试"),
        { status: 503, delivery: "not-sent", cause },
      );
    }
    const work = Promise.resolve()
      .then(fn)
      .then((result) => {
        this.records[id] = { hash, state: "done", result };
        this.save();
        return result;
      })
      .catch((error) => {
        if (error.delivery === "not-sent") delete this.records[id];
        else this.records[id] = { hash, state: "failed", error: error.message };
        this.save();
        throw error;
      })
      .finally(() => this.pending.delete(id));
    this.pending.set(id, work);
    return work;
  }
}
