import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageQueue } from "../server/message-queue.mjs";
import { Codex } from "../server/codex.mjs";
import { restoreDraft, clearWithdrawnSubmission } from "../src/lib/drafts.js";

test("confirmed withdrawal clears only its own stale submission receipt", () => {
  const entries = new Map([
    ["pending", JSON.stringify({ id: "withdrawn", signature: "same-text" })],
  ]);
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    removeItem: (key) => entries.delete(key),
  };
  assert.equal(
    clearWithdrawnSubmission(storage, "pending", "different"),
    false,
  );
  assert.ok(entries.has("pending"));
  assert.equal(clearWithdrawnSubmission(storage, "pending", "withdrawn"), true);
  assert.equal(entries.has("pending"), false);
  entries.set(
    "pending",
    JSON.stringify({ id: "new-send", signature: "same-text" }),
  );
  assert.equal(
    clearWithdrawnSubmission(storage, "pending", "withdrawn"),
    false,
  );
  assert.ok(entries.has("pending"));
});

test("withdraw receipt survives restart and lost acknowledgement; cannot dispatch again", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-receipt-"));
  try {
    const file = path.join(dir, "queue.json");
    let calls = 0;
    const adapters = {
      a: {
        detail: async () => ({ status: "idle" }),
        send: async () => {
          calls++;
        },
      },
    };
    const q = new MessageQueue(file, adapters);
    q.add("a", "s", "restore", "r", { id: "model" });
    const receipt = q.withdraw("a", "s", "r");
    const next = new MessageQueue(file, adapters);
    assert.deepEqual(next.withdraw("a", "s", "r"), receipt);
    await next.tick();
    assert.equal(calls, 0);
    const values = new Map([["draft", "typed while waiting"]]);
    const storage = {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
    };
    assert.equal(
      restoreDraft(storage, "draft", receipt).text,
      "typed while waiting\n\nrestore",
    );
    assert.equal(restoreDraft(storage, "draft", receipt).applied, false);
    assert.equal(
      JSON.parse(values.get("draft:record")).text,
      "typed while waiting\n\nrestore",
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("unknown submissions require positive native evidence, not absence or another instance", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-reconcile-"));
  try {
    const q = new MessageQueue(path.join(dir, "q.json"), {});
    q.items = [{ agent: "a", id: "s", requestId: "r", state: "uncertain" }];
    q.reconcile("a", "s", { nativeQueue: [] });
    assert.equal(q.items[0].state, "uncertain");
    q.reconcile("b", "s", { nativeQueue: [{ requestId: "r", nativeId: "n" }] });
    assert.equal(q.items[0].state, "uncertain");
    q.reconcile("a", "s", { offline: true, acceptedRequestIds: ["r"] });
    assert.equal(q.items[0].state, "uncertain");
    q.reconcile("a", "s", { nativeQueue: [{ requestId: "r", nativeId: "n" }] });
    assert.equal(q.items[0].state, "sent");
    assert.equal(q.items[0].receipt.nativeQueueId, "n");
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("failed receipt persistence does not falsely acknowledge withdrawal", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-write-"));
  try {
    const q = new MessageQueue(path.join(dir, "q.json"), {});
    q.add("a", "s", "text", "r");
    q.save = () => {
      throw Error("disk full");
    };
    assert.throws(() => q.withdraw("a", "s", "r"), /disk full/);
    assert.equal(q.items[0].state, "queued");
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("Codex native queue follows pagination and only user message IDs prove acceptance", async () => {
  const c = new Codex("test", "/tmp");
  c.control = {
    call: async (_, params) =>
      params.cursor
        ? { data: [{ id: "second" }], nextCursor: null }
        : { data: [{ id: "first" }], nextCursor: "next" },
  };
  assert.deepEqual(
    (await c.nativeQueue("s")).map((x) => x.id),
    ["first", "second"],
  );
  c.onMessage({
    method: "item/completed",
    params: { threadId: "s", item: { type: "agentMessage", clientId: "fake" } },
  });
  assert.equal(c.accepted.size, 0);
  c.onMessage({
    method: "item/completed",
    params: { threadId: "s", item: { type: "userMessage", clientId: "real" } },
  });
  assert.deepEqual([...c.accepted.get("s")], ["real"]);
});
