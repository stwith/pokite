import { createHash } from "node:crypto";
import { RetiredReceipts } from "./retired-receipts.mjs";
import { readJson, writeFileAtomic } from "./json-file.mjs";
export class Operations {
  constructor(file) {
    this.file = file;
    this.pending = new Map();
    this.retired = new RetiredReceipts(file + ".receipts.sqlite");
    this.records = readJson(file, {});
  }
  save() {
    const completed = Object.entries(this.records)
      .filter(([, r]) => r.state === "done")
      .sort((a, b) => (b[1].finishedAt || 0) - (a[1].finishedAt || 0));
    let bytes = 0;
    const expired = completed.filter(([, r], index) => {
      bytes += Buffer.byteLength(JSON.stringify(r));
      return (
        index >= 1000 ||
        bytes > 2 * 1024 * 1024 ||
        Date.now() - (r.finishedAt || 0) > 7 * 86400000
      );
    });
    this.retired.put(expired.map(([id, r]) => [id, r.hash]));
    for (const [id] of expired) delete this.records[id];
    writeFileAtomic(this.file, JSON.stringify(this.records));
  }
  async run(id, input, fn) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{12,100}$/.test(id))
      throw Object.assign(Error("Missing request id"), { status: 400 });
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const old = this.records[id];
    if (!old && this.retired.get(id))
      throw Object.assign(
        Error("此请求已处理，详细回执已过期；请核对原会话，不会再次执行。"),
        { status: 409 },
      );
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
        this.records[id] = {
          hash,
          state: "done",
          result,
          finishedAt: Date.now(),
        };
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
