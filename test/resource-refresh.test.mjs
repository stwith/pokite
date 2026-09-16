import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createRefreshLoop } from "../src/lib/resource-refresh.js";

function harness(refresh) {
  const state = { visible: true, connected: true, done: false };
  const timers = new Map();
  let id = 0;
  const loop = createRefreshLoop({
    refresh,
    interval: 2500,
    isVisible: () => state.visible,
    isConnected: () => state.connected,
    isDone: () => state.done,
    schedule: (fn, delay) => {
      timers.set(++id, { fn, delay });
      return id;
    },
    cancel: (key) => timers.delete(key),
  });
  return { state, timers, loop };
}
test("connection loss immediately replaces the slow polling schedule", async () => {
  let reads = 0;
  const h = harness(async () => {
    reads++;
  });
  await setImmediate();
  assert.equal([...h.timers.values()][0].delay, 30000);
  h.state.connected = false;
  h.loop.reschedule();
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 2500);
  h.state.visible = false;
  await h.loop.trigger();
  assert.equal(h.timers.size, 0);
  assert.equal(reads, 1);
  h.state.visible = true;
  await h.loop.trigger();
  assert.equal(reads, 2);
  h.loop.stop();
  assert.equal(h.timers.size, 0);
});
test("bursts during a slow read collapse to one follow-up and dispose prevents more work", async () => {
  let release,
    reads = 0;
  const h = harness(() => {
    reads++;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  for (let i = 0; i < 20; i++) void h.loop.trigger();
  assert.equal(reads, 1);
  release();
  await setImmediate();
  assert.equal(reads, 2);
  void h.loop.trigger();
  h.loop.stop();
  release();
  await setImmediate();
  assert.equal(reads, 2);
  assert.equal(h.timers.size, 0);
});
test("successful one-shot loads leave no timers; rejected refresh can recover", async () => {
  const h = harness(async () => {});
  h.state.done = true;
  await setImmediate();
  assert.equal(h.timers.size, 0);
  h.loop.stop();
  let reads = 0;
  const failure = harness(async () => {
    if (++reads === 1) throw Error("offline");
  });
  await setImmediate();
  assert.equal(failure.timers.size, 1);
  await failure.loop.trigger();
  assert.equal(reads, 2);
  failure.loop.stop();
});
