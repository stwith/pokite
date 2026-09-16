import fs from "node:fs";
const hidden = new Set(["sent", "withdrawn", "removed"]);

export class MessageQueue {
  constructor(file, adapters) {
    this.file = file;
    this.adapters = adapters;
    this.active = new Set();
    this.inFlight = new Set();
    this.stopping = false;
    this.items = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : [];
    for (const item of this.items)
      if (item.state === "sending") {
        item.state = "uncertain";
        item.error = "服务重启，提交结果待确认；请检查原会话，避免重复发送。";
      }
    this.save();
  }
  save() {
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.items), {
      mode: 0o600,
    });
    fs.renameSync(this.file + ".tmp", this.file);
  }
  list(agent, id) {
    return this.items.filter(
      (x) => x.agent === agent && x.id === id && !hidden.has(x.state),
    );
  }
  remove(agent, id, requestId) {
    const item = this.items.find(
      (x) => x.agent === agent && x.id === id && x.requestId === requestId,
    );
    if (item?.state === "removed") return;
    if (!item || ["sending", "sent", "withdrawn"].includes(item.state))
      throw Object.assign(
        Error("消息正在提交或已交给 Agent，无法从本地队列移除"),
        { status: 409 },
      );
    const previous = { ...item };
    item.state = "removed";
    item.removedAt = Date.now();
    try {
      this.save();
    } catch (error) {
      Object.keys(item).forEach((k) => delete item[k]);
      Object.assign(item, previous);
      throw error;
    }
  }
  add(agent, id, text, requestId, model) {
    if (!this.items.some((x) => x.requestId === requestId)) {
      this.items.push({
        agent,
        id,
        text,
        requestId,
        model,
        state: "queued",
        createdAt: Date.now(),
      });
      try {
        this.save();
      } catch (error) {
        this.items.pop();
        throw error;
      }
    }
    return { accepted: true, queued: true };
  }
  withdraw(agent, id, requestId) {
    const item = this.items.find(
      (x) => x.agent === agent && x.id === id && x.requestId === requestId,
    );
    if (!item || !["queued", "withdrawn"].includes(item.state))
      throw Object.assign(Error("消息已提交或状态待确认，无法撤回编辑"), {
        status: 409,
      });
    if (item.state !== "withdrawn") {
      const previous = { ...item };
      item.state = "withdrawn";
      item.withdrawnAt = Date.now();
      try {
        this.save();
      } catch (error) {
        Object.keys(item).forEach((k) => delete item[k]);
        Object.assign(item, previous);
        throw error;
      }
    }
    return { text: item.text, model: item.model, receiptId: item.requestId };
  }
  reconcile(agent, id, detail) {
    if (detail.offline) return;
    let changed = false;
    for (const item of this.items) {
      if (item.agent !== agent || item.id !== id || item.state !== "uncertain")
        continue;
      const native = detail.nativeQueue?.find(
        (q) => q.requestId === item.requestId,
      );
      const receiptId =
        this.adapters[agent]?.receiptId?.(item.requestId) || item.requestId;
      const consumed = detail.acceptedRequestIds?.includes(receiptId);
      if (!native && !consumed) continue;
      item.state = "sent";
      item.receipt = {
        accepted: true,
        ...(native ? { nativeQueueId: native.nativeId } : { consumed: true }),
      };
      delete item.error;
      changed = true;
    }
    if (changed) this.save();
  }
  tick() {
    if (this.stopping) return Promise.resolve();
    const work = this.runTick();
    this.inFlight.add(work);
    const done = () => this.inFlight.delete(work);
    work.then(done, done);
    return work;
  }
  async stop() {
    this.stopping = true;
    const results = await Promise.allSettled([...this.inFlight]);
    if (results.some((result) => result.status === "rejected"))
      throw Error("Queue could not finish persisting its in-flight submission");
  }
  async runTick() {
    await Promise.all(
      [
        ...new Set(
          this.items
            .filter((x) => !hidden.has(x.state))
            .map((x) => x.agent + ":" + x.id),
        ),
      ].map(async (key) => {
        if (this.active.has(key)) return;
        const item = this.items.find(
          (x) => x.agent + ":" + x.id === key && !hidden.has(x.state),
        );
        if (!item || !["queued", "uncertain"].includes(item.state)) return;
        this.active.add(key);
        try {
          if (this.adapters[item.agent].readOnly) return;
          const adapter = this.adapters[item.agent],
            detail = await adapter.detail(item.id);
          // A user may withdraw this item while the native status request is pending.
          this.reconcile(item.agent, item.id, detail);
          if (
            this.stopping ||
            !this.items.includes(item) ||
            item.state !== "queued"
          )
            return;
          if (
            !["idle", "completed", "failed", "interrupted"].includes(
              detail.status,
            ) ||
            detail.offline ||
            detail.readOnly ||
            detail.pending?.length
          )
            return;
          item.state = "sending";
          try {
            this.save();
          } catch (cause) {
            item.state = "queued";
            throw Object.assign(
              Error("消息尚未提交：无法保存发送状态，请检查磁盘"),
              { delivery: "not-sent", cause },
            );
          }
          try {
            item.receipt = await adapter.send(
              item.id,
              item.text,
              item.requestId,
              item.model,
            );
            item.state = "sent";
          } catch (e) {
            if (e.retrySafe === true || e.delivery === "not-sent") {
              item.state = "queued";
              item.error =
                e.delivery === "not-sent"
                  ? "等待桌面连接"
                  : e.retrySafe
                    ? e.message
                    : "等待原客户端释放当前轮次";
            } else {
              item.state = "uncertain";
              item.error = e.message;
            }
          }
          try {
            this.save();
          } catch (cause) {
            if (item.state === "sent") {
              item.state = "uncertain";
              throw Object.assign(
                Error("提交已返回，但回执未能保存；请核对原会话，暂不重发"),
                { delivery: "unknown", cause },
              );
            }
            throw cause;
          }
        } catch (e) {
          item.error = e.message;
          this.save();
        } finally {
          this.active.delete(key);
        }
      }),
    );
  }
}
