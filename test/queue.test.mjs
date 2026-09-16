import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageQueue } from "../server/message-queue.mjs";
test("error wording cannot turn an ambiguous delivery into an automatic retry", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-delivery-"));
  try {
    let calls = 0;
    const q = new MessageQueue(path.join(dir, "queue.json"), {
      a: {
        detail: async () => ({ status: "idle" }),
        send: async () => {
          calls++;
          throw Error("正在等待响应: already running after timeout");
        },
      },
    });
    q.add("a", "s", "once", "r");
    await q.tick();
    await q.tick();
    assert.equal(calls, 1);
    assert.equal(q.list("a", "s")[0].state, "uncertain");
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("only explicit safe retry and known writable inactive state permit dispatch", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-ready-"));
  try {
    let detail = {},
      calls = 0;
    const q = new MessageQueue(path.join(dir, "queue.json"), {
      a: {
        detail: async () => detail,
        send: async () => {
          calls++;
          if (calls === 1)
            throw Object.assign(Error("busy"), { retrySafe: true });
          return { accepted: true };
        },
      },
    });
    q.add("a", "s", "once", "r");
    for (const state of [
      {},
      { status: "new-upstream-state" },
      { status: "running" },
      { status: "idle", offline: true },
      { status: "idle", readOnly: true },
      { status: "idle", pending: [{}] },
    ]) {
      detail = state;
      await q.tick();
    }
    assert.equal(calls, 0);
    detail = { status: "idle" };
    await q.tick();
    assert.equal(q.list("a", "s")[0].state, "queued");
    await q.tick();
    assert.equal(calls, 2);
    assert.equal(q.list("a", "s").length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("withdraw during status lookup never dispatches and preserves text/settings", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-withdraw-"));
  try {
    let resolve,
      sends = 0;
    const q = new MessageQueue(path.join(dir, "queue.json"), {
      a: {
        detail: () =>
          new Promise((r) => {
            resolve = r;
          }),
        send: async () => {
          sends++;
        },
      },
    });
    q.add("a", "s", "edit me", "r", { id: "model", effort: "high" });
    const tick = q.tick();
    assert.deepEqual(q.withdraw("a", "s", "r"), {
      receiptId: "r",
      text: "edit me",
      model: { id: "model", effort: "high" },
    });
    resolve({ status: "idle" });
    await tick;
    assert.equal(sends, 0);
    assert.equal(q.list("a", "s").length, 0);
    assert.equal(q.withdraw("a", "s", "r").text, "edit me");
    for (const state of ["sending", "sent", "uncertain"]) {
      q.items = [{ agent: "a", id: "s", requestId: "r", state }];
      assert.throws(() => q.withdraw("a", "s", "r"), { status: 409 });
      assert.equal(q.items.length, 1);
    }
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("queued messages wait for running turns, preserve order and survive restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-queue-"));
  try {
    let status = "running";
    const sent = [];
    const adapters = {
      a: {
        detail: async () => ({ status }),
        send: async (id, text) => {
          sent.push(text);
          status = "running";
        },
      },
    };
    let q = new MessageQueue(path.join(dir, "queue.json"), adapters);
    q.add("a", "s", "one", "one");
    q.add("a", "s", "one", "one");
    q.add("a", "s", "two", "two");
    await q.tick();
    assert.equal(sent.length, 0);
    q = new MessageQueue(path.join(dir, "queue.json"), adapters);
    status = "completed";
    await Promise.all([q.tick(), q.tick()]);
    assert.deepEqual(sent, ["one"]);
    status = "completed";
    await q.tick();
    assert.deepEqual(sent, ["one", "two"]);
    assert.equal(q.list("a", "s").length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("ambiguous submission is not automatically sent twice or overtaken", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-queue-"));
  try {
    let calls = 0;
    const adapters = {
      a: {
        detail: async () => ({ status: "idle" }),
        send: async () => {
          calls++;
          throw Error("timeout");
        },
      },
    };
    let q = new MessageQueue(path.join(dir, "queue.json"), adapters);
    q.add("a", "s", "one", "one");
    q.add("a", "s", "two", "two");
    await q.tick();
    await q.tick();
    q = new MessageQueue(path.join(dir, "queue.json"), adapters);
    await q.tick();
    assert.equal(calls, 1);
    assert.equal(q.list("a", "s")[0].state, "uncertain");
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
