import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  remoteMessages,
  remoteSessionStatus,
  userEvent,
  nativeRequestId,
} from "../server/claude-desktop-events.mjs";
import { ClaudeDesktopRemote } from "../server/claude-desktop-remote.mjs";
import { SessionEvents } from "../server/session-events.mjs";
import { MessageQueue } from "../server/message-queue.mjs";

test("Cowork adapter never exposes or sends Desktop Code sessions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-only-"));
  try {
    await fs.writeFile(path.join(root, "config.json"), JSON.stringify({ lastKnownAccountUuid: "account" }));
    const dir = path.join(root, "claude-code-sessions/account/org");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "local_one.json"), JSON.stringify({sessionId:"local_one",cliSessionId:"cli",title:"Code",originCwd:"/work",bridgeSessionIds:["session_bridge"]}));
    const adapter = new ClaudeDesktopRemote(root, { client: {
      identity: async () => ({account:"account",organization:"org"}),
      request: async () => { throw Error("Code must not contact remote APIs"); },
      close: async () => {},
    } });
    assert.equal((await adapter.projects()).length, 0);
    const id = "code:account:org:local_one";
    await assert.rejects(adapter.detail(id), {status:404});
    await assert.rejects(adapter.send(id,"hello","request"), {delivery:"not-sent"});
    await adapter.close();
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test("Cowork web request IDs reconcile from native UUID echoes after restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-receipt-"));
  try {
    const requestId = "a".repeat(36);
    const native = nativeRequestId(requestId);
    assert.match(
      native,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(nativeRequestId(requestId), native);
    const file = path.join(root, "queue.json");
    await fs.writeFile(
      file,
      JSON.stringify([
        { agent: "cowork", id: "s", requestId, state: "sending" },
      ]),
    );
    const q = new MessageQueue(file, {
      cowork: { receiptId: nativeRequestId },
    });
    q.reconcile("cowork", "other", { acceptedRequestIds: [native] });
    assert.equal(q.items[0].state, "uncertain");
    q.reconcile("cowork", "s", { acceptedRequestIds: [native] });
    assert.equal(q.items[0].state, "sent");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Cowork parser keeps visible chronological messages and receipt identities", () => {
  const event = (n, type, uuid, content, extra = {}) => ({
    sequence_num: String(n),
    created_at: "time",
    payload: { type, uuid, message: { content }, ...extra },
  });
  const result = remoteMessages([
    event("9007199254740995", "assistant", "a", [
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: "final" },
    ]),
    event("9007199254740993", "user", "u", "hello"),
    event("9007199254740994", "assistant", "a", "partial"),
    event("9007199254740996", "user", "tool", [
      { type: "tool_result", content: "hidden" },
    ]),
    event("9007199254740997", "assistant", "child", "hidden", {
      parent_tool_use_id: "tool",
    }),
    event("9007199254740998", "user", "meta", "hidden", { isMeta: true }),
  ]);
  assert.deepEqual(
    result.messages.map((m) => m.text),
    ["hello", "final"],
  );
  assert.ok(result.acceptedRequestIds.includes("u"));
  assert.equal(remoteSessionStatus({ worker_status: "running" }), "running");
  assert.equal(
    remoteSessionStatus({ worker_status: "requires_action" }),
    "waiting",
  );
  assert.equal(
    remoteSessionStatus({ worker_status: "unrecognized" }),
    "unknown",
  );
  assert.equal(
    userEvent("cse_1", "request-1", "hello").events[0].payload.uuid,
    nativeRequestId("request-1"),
  );
});

test("Cowork adapter discovers metadata only, pages history, sends to same session and rejects unknown IDs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-adapter-"));
  const calls = [];
  try {
    const dir = path.join(root, "local-agent-mode-sessions/account/org");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(root, "config.json"),
      JSON.stringify({ lastKnownAccountUuid: "account" }),
    );
    await fs.writeFile(
      path.join(dir, "spaces.json"),
      JSON.stringify({ spaces: [{ id: "p", name: "Project", folders: [] }] }),
    );
    await fs.writeFile(
      path.join(dir, "remote-session-spaces.json"),
      JSON.stringify({ entries: [{ sessionId: "session_Ab1", spaceId: "p" }] }),
    );
    let waiting = false;
    const client = {
      identity: async () => ({ account: "account", organization: "org" }),
      close: async () => {},
      request: async (route, options = {}) => {
        calls.push({ route, options });
        assert.equal(options.scope, "account:org");
        if (options.method === "POST") return { accepted: true };
        if (route.includes("/events"))
          return {
            data: [
              {
                sequence_num: "1",
                payload: {
                  type: "assistant",
                  uuid: "m",
                  message: { content: "answer" },
                },
              },
            ],
            next_cursor: null,
          };
        return {
          response_shape: {
            id: "cse_Ab1",
            title: "Same session",
            worker_status: waiting ? "requires_action" : "idle",
            status: "active",
            environment_kind: "anthropic_cloud",
            connection_status: "disconnected",
          },
        };
      },
    };
    const a = new ClaudeDesktopRemote(root, { client });
    const projects = await a.projects();
    assert.equal(calls.length, 0);
    const sessions = await a.sessions(projects[0].id);
    assert.equal(calls.length, 1);
    assert.equal(sessions[0].offline, false);
    const detail = await a.detail(sessions[0].id);
    assert.deepEqual(
      detail.messages.map((m) => m.text),
      ["answer"],
    );
    assert.equal(detail.scope, undefined);
    await assert.rejects(
      a.send("remote:other:org:cse_X", "hello", "req"),
      /不可回复/,
    );
    assert.equal(calls.filter((c) => c.options.method === "POST").length, 0);
    assert.equal((await a.send(sessions[0].id, "hello", "req")).accepted, true);
    const sent = calls.find((c) => c.options.method === "POST");
    assert.equal(sent.options.body.session_id, "cse_Ab1");
    assert.equal(
      sent.options.body.events[0].payload.message.content[0].text,
      "hello",
    );
    waiting = true;
    await assert.rejects(a.send(sessions[0].id, "hello", "req2"), /等待/);
    assert.equal(calls.filter((c) => c.options.method === "POST").length, 1);
    await a.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Remote change polling releases with the final visible subscriber", () => {
  let started = 0,
    released = 0;
  const events = new SessionEvents({
    remote: {
      subscribeChanges() {
        started++;
        return () => released++;
      },
    },
  });
  const a = events.subscribe("remote", () => {});
  const b = events.subscribe("remote", () => {});
  assert.equal(started, 1);
  a();
  assert.equal(released, 0);
  b();
  assert.equal(released, 1);
  events.close();
  assert.equal(released, 1);
});
