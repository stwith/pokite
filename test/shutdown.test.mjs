import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { shutdownServer } from "../server/shutdown.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { installWriteLifecycle } from "../server/write-lifecycle.mjs";
import { Claude } from "../server/claude.mjs";

test("Claude close waits for the final interrupted-state write", async () => {
  let release;
  const finishing = new Promise((resolve) => (release = resolve));
  const c = new Claude({
    listSessions: () => finishing,
    query: ({ options }) =>
      Object.assign(
        (async function* () {
          await new Promise((resolve) =>
            options.abortController.signal.addEventListener("abort", resolve, {
              once: true,
            }),
          );
          throw Error("aborted");
        })(),
        { close() {} },
      ),
  });
  c.states = {};
  let saves = 0;
  c.save = () => saves++;
  c.detail = async () => ({
    canReply: true,
    projectId: "/tmp",
    title: "fixture",
  });
  await c.send("fixture", "text", "request");
  let done = false;
  const close = c.close().then(() => (done = true));
  await setImmediate();
  assert.equal(done, false);
  release([]);
  await close;
  assert.equal(c.states.fixture.status, "interrupted");
  assert.equal(saves, 2);
});

test("a disconnected HTTP client does not remove an active write from the drain", async () => {
  const app = express(),
    post = installWriteLifecycle(app);
  let enter,
    release,
    completed = false;
  const entered = new Promise((resolve) => (enter = resolve)),
    gate = new Promise((resolve) => (release = resolve));
  post("/work", async (req, res) => {
    enter();
    await gate;
    completed = true;
    res.json({ ok: true });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const controller = new AbortController();
    const request = fetch(base + "/work", {
      method: "POST",
      signal: controller.signal,
    }).catch(() => {});
    await entered;
    controller.abort();
    await request;
    app.locals.beginShutdown();
    let drained = false;
    const draining = app.locals.drainWrites().then(() => (drained = true));
    await setImmediate();
    assert.equal(drained, false);
    const rejected = await fetch(base + "/work", { method: "POST" });
    assert.equal(rejected.status, 503);
    await rejected.text();
    release();
    await draining;
    assert.equal(completed, true);
  } finally {
    release();
    await app.locals.drainWrites();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("shutdown waits for in-flight work and read persistence before closing adapters", async () => {
  const order = [];
  let drain, flush;
  const writes = new Promise((resolve) => (drain = resolve)),
    persisted = new Promise((resolve) => (flush = resolve));
  const stopping = shutdownServer({
    app: {
      locals: {
        beginShutdown: () => order.push("reject-new"),
        drainWrites: () => writes,
        events: { close: () => order.push("events-close") },
      },
    },
    server: {
      close: () => order.push("stop-listening"),
      closeAllConnections: () => order.push("connections-close"),
    },
    messages: { stop: () => writes },
    adapters: { a: { close: () => order.push("adapter-close") } },
    flushReads: async () => {
      order.push("flush");
      await persisted;
    },
  });
  await setImmediate();
  assert.deepEqual(order, ["reject-new", "stop-listening"]);
  drain();
  await setImmediate();
  assert.deepEqual(order, ["reject-new", "stop-listening", "flush"]);
  flush();
  await stopping;
  assert.deepEqual(order.slice(-2), ["adapter-close", "connections-close"]);
});
test("queue stop waits for an already submitted message but starts no next message", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-drain-"));
  try {
    let finish,
      calls = 0;
    const q = new MessageQueue(path.join(directory, "queue.json"), {
      a: {
        detail: async () => ({ status: "idle" }),
        send: () => {
          calls++;
          return new Promise((resolve) => (finish = resolve));
        },
      },
    });
    q.add("a", "s", "first", "r1");
    q.add("a", "s", "second", "r2");
    const tick = q.tick();
    await setImmediate();
    assert.equal(calls, 1);
    let stopped = false;
    const stop = q.stop().then(() => (stopped = true));
    await setImmediate();
    assert.equal(stopped, false);
    finish({ accepted: true });
    await tick;
    await stop;
    await q.tick();
    assert.equal(calls, 1);
    assert.equal(q.items[0].state, "sent");
    assert.equal(q.items[1].state, "queued");
    assert.equal(JSON.parse(fs.readFileSync(q.file))[0].state, "sent");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
