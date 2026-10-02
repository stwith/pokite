import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { WebSocketServer } from "ws";
import { createApp } from "../server/app.mjs";
import { Operations } from "../server/operations.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
import { Claude } from "../server/claude.mjs";
import { Dsh } from "../server/dsh.mjs";
import { DshRemote } from "../server/dsh-remote.mjs";
import { HermesDesktop } from "../server/hermes-desktop.mjs";

async function httpFixture(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-audit-regression-"));
  const adapter = {
    projects: async () => [{ id: "p", path: dir }],
    detail: async (id) => ({ id, projectId: "p", status: "idle", messages: [] }),
    create: async () => ({ id: "created" }),
    send: async () => ({ accepted: true }),
  };
  const adapters = { fixture: adapter };
  const operations = new Operations(path.join(dir, "ops.json"));
  const messages = new MessageQueue(path.join(dir, "queue.json"), adapters);
  let server;
  const app = createApp({ adapters, agentNames: { fixture: "Fixture" }, token: "test",
    operations, messages, reads: {}, saveReads() {}, dist: dir,
    getPort: () => server.address().port });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/fixture` + route, {
      method: body ? "POST" : "GET",
      headers: { authorization: "Bearer test", "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ dir, adapter, operations, messages, request }); }
  finally {
    await messages.stop();
    app.locals.events.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("new-session first message enters durable queue and unknown delivery never replays", () =>
  httpFixture(async ({ adapter, operations, messages, request }) => {
    let creates = 0, sends = 0;
    adapter.create = async () => { creates++; return { id: "created" }; };
    adapter.send = async () => { sends++; throw Error("response lost after acceptance"); };
    const body = { projectId: "p", text: "first", requestId: "audit-first-message" };
    assert.equal((await request("/sessions", body)).status, 200);
    assert.equal(sends, 0, "creation must not bypass queue");
    assert.equal(messages.list("fixture", "created")[0].state, "queued");
    await messages.tick();
    assert.equal(messages.list("fixture", "created")[0].state, "uncertain");
    await request("/sessions", body);
    await messages.tick();
    assert.equal(creates, 1);
    assert.equal(sends, 1);
    const restarted = new MessageQueue(messages.file, { fixture: adapter });
    await restarted.tick();
    assert.equal(sends, 1);
    assert.equal(new Operations(operations.file).records[body.requestId].result.session.id, "created");
  }));

test("queue persistence failure after creation retries the same session across restart", () =>
  httpFixture(async ({ adapter, operations, messages, request }) => {
    let creates = 0;
    adapter.create = async () => { creates++; return { id: "created" }; };
    const save = messages.save.bind(messages);
    messages.save = () => { throw Error("disk full"); };
    const body = { projectId: "p", text: "first", requestId: "audit-create-save" };
    const first = await request("/sessions", body);
    assert.equal(first.body.id, "created");
    assert.ok(first.body.error);
    assert.equal(messages.items.length, 0);
    messages.save = save;
    operations.records = new Operations(operations.file).records;
    const second = await request("/sessions", body);
    assert.equal(second.body.error, undefined);
    assert.equal(creates, 1);
    assert.equal(messages.list("fixture", "created").length, 1);
  }));

test("creation retries preserve the initial model and never replay legacy direct-send receipts", () =>
  httpFixture(async ({ adapter, operations, messages, request }) => {
    let creates = 0;
    adapter.create = async () => { creates++; return { id: "created" }; };
    adapter.models = async () => ({ options: [{ id: "m", model: "original" }], canSwitch: true });
    const body = { projectId: "p", text: "first", modelId: "m", requestId: "audit-model-checkpoint" };
    await request("/sessions", body);
    adapter.models = async () => ({ options: [{ id: "m", model: "changed" }], canSwitch: true });
    assert.equal((await request("/sessions", body)).body.error, undefined);
    assert.equal(messages.items[0].model.model, "original");
    assert.equal(creates, 1);
    const legacy = { projectId: "p", text: "legacy", requestId: "audit-legacy-receipt" };
    const result = { id: "old", error: "legacy unknown delivery" };
    await operations.run(legacy.requestId, { path: "/api/fixture/sessions", body: legacy }, () => result);
    assert.deepEqual((await request("/sessions", legacy)).body, result);
    assert.equal(creates, 1);
    assert.equal(messages.items.length, 1);
  }));

for (const failedStage of ["detail", "projects", "models", "queue-save"]) {
  test(`pre-enqueue ${failedStage} failure permits the original request to retry`, () =>
    httpFixture(async ({ adapter, messages, request }) => {
      const restore = failedStage === "queue-save" ? messages.save.bind(messages) : adapter[failedStage];
      if (failedStage === "queue-save") messages.save = () => { throw Error("temporary failure"); };
      else adapter[failedStage] = async () => { throw Error("temporary failure"); };
      const body = { text: "retry", requestId: "audit-preflight-retry", ...(failedStage === "models" ? { modelId: "m" } : {}) };
      assert.equal((await request("/sessions/s/messages", body)).status, 502);
      if (failedStage === "queue-save") messages.save = restore;
      else adapter[failedStage] = failedStage === "models"
        ? async () => ({ options: [{ id: "m" }], canSwitch: true }) : restore;
      assert.equal((await request("/sessions/s/messages", body)).status, 200);
      assert.equal(messages.list("fixture", "s").length, 1);
    }));
}

test("Hermes unassigned history is readable but cannot create a session", () =>
  httpFixture(async ({ adapter, dir, request }) => {
    const hermes = new HermesDesktop(dir);
    hermes.rows = () => [{ id: "stored", profile: "default", cwd: null, title: "History" }];
    Object.assign(adapter, { projects: hermes.projects.bind(hermes), supportsVirtualProjects: hermes.supportsVirtualProjects,
      sessions: async () => [{ id: "stored", revision: "1" }] });
    const [project] = await adapter.projects();
    assert.equal((await request("/sessions?projectId=" + encodeURIComponent(project.id))).status, 200);
    assert.equal((await request("/sessions", { projectId: project.id, text: "no", requestId: "audit-hermes-create" })).status, 400);
  }));

test("Claude pre-execution save failure restores old state and releases its job", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-claude-rollback-"));
  try {
    const c = new Claude({}, { root: dir, desktopRoot: dir, stateFile: path.join(dir, "state.json") });
    const previous = { status: "idle", title: "original", cwd: dir };
    c.states.s = previous;
    c.detail = async () => ({ projectId: dir, title: "original", canReply: !c.jobs.has("s") });
    let calls = 0;
    c.drive = async () => { calls++; c.jobs.delete("s"); };
    c.save = () => { throw Error("ENOSPC"); };
    await assert.rejects(c.send("s", "hello", "request"), { delivery: "not-sent" });
    assert.equal(c.states.s, previous);
    assert.equal(c.jobs.size, 0);
    assert.equal(calls, 0);
    c.save = () => {};
    await c.send("s", "hello", "request");
    assert.equal(calls, 1);
    delete c.states.new;
    c.save = () => { throw Error("ENOSPC"); };
    await assert.rejects(c.send("new", "hello", "request"));
    assert.equal(Object.hasOwn(c.states, "new"), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("DSH writer-held stays queued and recovers after release", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-dsh-recovery-"));
  const dsh = new Dsh("http://127.0.0.1:1", { authFile: path.join(dir, "auth.json") });
  try {
    dsh.version = async () => 2;
    dsh.detail = async () => ({ status: "idle" });
    dsh.remote.call = async () => { throw Object.assign(Error("held"), { code: "session/writer-held" }); };
    const q = new MessageQueue(path.join(dir, "queue.json"), { dsh });
    q.add("dsh", "s", "first", "audit-held-message");
    await q.tick();
    assert.equal(q.items[0].state, "queued");
    dsh.remote.call = async () => ({});
    await q.tick();
    assert.equal(q.items[0].state, "sent");
    q.add("dsh", "s", "second", "audit-withdraw-message");
    dsh.remote.call = async () => { throw Object.assign(Error("held"), { code: "session/writer-held" }); };
    await q.tick();
    assert.equal(q.withdraw("dsh", "s", "audit-withdraw-message").text, "second");
    await q.stop();
  } finally { dsh.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test("DSH transient and malformed probes are not cached as legacy", async () => {
  const dsh = new Dsh("http://127.0.0.1:1");
  try {
    for (const response of [new Response("outage", { status: 500 }), new Response("{}"), new Response("invalid json")]) {
      dsh.fetchAuthorized = async () => response;
      await assert.rejects(dsh.version());
      assert.equal(dsh.versionCheck, null);
    }
    dsh.fetchAuthorized = async () => Response.json({ result: { ok: true, value: { items: [] } } });
    assert.equal(await dsh.version(), 2);
    dsh.versionCheck = null;
    dsh.fetchAuthorized = async () => new Response("legacy", { status: 404 });
    assert.equal(await dsh.version(), 1);
    await assert.rejects(dsh.call("session.list"));
    assert.equal(dsh.versionCheck, null);
    dsh.fetchAuthorized = async () => Response.json({ result: { ok: true, value: { items: [] } } });
    assert.equal(await dsh.version(), 2);
  } finally { dsh.close(); }
});

test("DSH cancelled CONNECTING stream never opens after delayed handshake", async () => {
  const listener = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  const frames = [];
  listener.on("upgrade", (req, socket, head) => setTimeout(() => {
    wss.handleUpgrade(req, socket, head, (ws) => ws.on("message", (raw) => frames.push(JSON.parse(raw))));
  }, 60));
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const remote = new DshRemote(`http://127.0.0.1:${listener.address().port}`, { headers: () => ({}) });
  try {
    const cancel = remote.stream("workspace/follow", {}, { item() {} });
    cancel(); cancel();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(frames, []);
    assert.equal(remote.streams.size, 0);
  } finally {
    remote.close();
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => listener.close(resolve));
  }
});
