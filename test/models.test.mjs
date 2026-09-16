import test from "node:test";
import assert from "node:assert/strict";
import { Codex, Penguin } from "../server/adapters.mjs";
test("Codex recovery blocks all creation and sending before native access", async () => {
  const c = new Codex("test", "/tmp");
  const calls = [];
  c.detail = async () => ({ canReply: true, pending: [], status: "completed" });
  c.rpc.call = async (method, payload) => {
    calls.push({ method, payload });
    return { turn: { id: "turn" } };
  };
  await assert.rejects(
    c.send("thread", "hello", "request", { model: "selected-model" }),
    /写入保护/,
  );
  await assert.rejects(c.create({ nativeId: "project" }), /写入保护/);
  assert.equal(calls.length, 0);
});
test("Penguin catalog strips credentials and disables existing-session changes", async () => {
  const p = new Penguin();
  p.call = async (endpoint) =>
    endpoint.includes("/sessions/")
      ? { session: { provider: "custom", modelId: "model-a" } }
      : {
          defaultModel: { provider: "custom", modelId: "model-a" },
          models: [
            {
              provider: "custom",
              modelId: "model-a",
              credential: { apiKey: "never-expose", baseUrl: "private" },
            },
          ],
        };
  const catalog = await p.models({ project: "project" }, "session");
  assert.equal(catalog.canSwitch, false);
  assert.equal(JSON.stringify(catalog).includes("never-expose"), false);
  assert.equal(JSON.stringify(catalog).includes("private"), false);
});
test("Codex reader rejects native queue and settings mutations", async () => {
  const c = new Codex("test", "/tmp");
  for (const method of [
    "thread/queue/add",
    "thread/resume",
    "thread/start",
    "turn/start",
    "config/write",
    "thread/unsubscribe",
  ])
    await assert.rejects(c.rpc.call(method, {}), /只读/);
});
test("session summaries do not load transcript bodies and share read revisions", async () => {
  const c = new Codex("test", "/tmp");
  c.projects = async () => [];
  c.projectFor = () => "p";
  c.log = async () => {
    throw Error("Transcript should not be read for sidebar");
  };
  const row = await c.row({ id: "s", updatedAt: 4, preview: "Title" });
  assert.equal(row.revision, "4");
  assert.equal(row.title, "Title");
  assert.equal(row.messages, undefined);
  c.projectCache = {
    state: {
      "electron-thread-read-state-v1": {
        unreadByIdentity: { account: { "local:device": ["s"] } },
      },
    },
  };
  assert.equal((await c.row({ id: "s", updatedAt: 4 })).nativeUnread, true);
  c.projectCache.state[
    "electron-thread-read-state-v1"
  ].unreadByIdentity.account["local:device"] = [];
  assert.equal((await c.row({ id: "s", updatedAt: 4 })).nativeUnread, false);
  c.log = async () => ({
    status: "completed",
    completedAt: "different",
    messages: [],
  });
  assert.equal(
    (await c.row({ id: "s", updatedAt: 4 }, true)).revision,
    row.revision,
  );
});
