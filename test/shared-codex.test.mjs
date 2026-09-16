import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Codex } from "../server/adapters.mjs";
import { SharedRpc } from "../server/shared-rpc.mjs";

function harness({ busy = false, queued = false, afterHead = null } = {}) {
  const calls = [];
  let added = false;
  const control = Object.assign(new EventEmitter(), {
    connect: async () => {},
    close: () => {},
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/queue/list")
        return {
          data: queued
            ? [{ id: "desktop-item" }]
            : added && afterHead
              ? [{ id: afterHead }]
              : [],
        };
      if (method === "thread/read")
        return { thread: { status: { type: busy ? "active" : "idle" } } };
      if (method === "thread/queue/add") {
        added = true;
        return { queuedSubmission: { id: "phone-item" } };
      }
      return {};
    },
  });
  return { adapter: new Codex("test", "/tmp", { control }), calls };
}
test("shared sender leaves existing Desktop queue and settings untouched", async () => {
  const { adapter, calls } = harness({ queued: true });
  await assert.rejects(
    adapter.send("s", "phone", "id", { model: "m", effort: "high" }),
    (e) => e.retrySafe === true,
  );
  assert.deepEqual(
    calls.map((c) => c.method),
    ["thread/queue/list"],
  );
});
test("an active Desktop turn is never interrupted to send a phone message", async () => {
  const { adapter, calls } = harness({ busy: true });
  await assert.rejects(
    adapter.send("s", "phone", "id"),
    (e) => e.retrySafe === true,
  );
  assert.equal(
    calls.some((c) => /interrupt|queue\/add|settings\/update/.test(c.method)),
    false,
  );
});
test("idle shared submission uses native append and preserves permissions", async () => {
  const { adapter, calls } = harness();
  assert.equal(
    (await adapter.send("s", "phone", "id", { model: "m", effort: "high" }))
      .accepted,
    true,
  );
  assert.deepEqual(calls.find((c) => c.method === "thread/resume").params, {
    threadId: "s",
    excludeTurns: true,
  });
  assert.deepEqual(
    calls.find((c) => c.method === "thread/settings/update").params,
    { threadId: "s", model: "m", effort: "high" },
  );
  assert.equal(
    calls.some((c) =>
      [
        "turn/start",
        "thread/queue/delete",
        "thread/queue/update",
        "thread/queue/reorder",
      ].includes(c.method),
    ),
    false,
  );
});
test("paused queue resumes only the phone item at its head", async () => {
  for (const head of ["phone-item", "desktop-item"]) {
    const { adapter, calls } = harness({ afterHead: head });
    await adapter.send("s", "phone", "id");
    const starts = calls.filter((c) => c.method === "thread/queue/start");
    assert.equal(starts.length, head === "phone-item" ? 1 : 0);
    if (starts.length)
      assert.equal(starts[0].params.queuedSubmissionId, "phone-item");
  }
});
test("shared control refuses non-loopback endpoints", () => {
  assert.throws(() => new SharedRpc("ws://192.168.1.6:3233"), /loopback/);
  assert.throws(() => new SharedRpc("wss://example.com"), /loopback/);
});
