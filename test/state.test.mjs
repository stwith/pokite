import test from "node:test";
import assert from "node:assert/strict";
import { codexFold, textContent, Codex, Penguin } from "../server/adapters.mjs";

test("Penguin approval uses native payload identity and resolves only the matching session", () => {
  const p = new Penguin();
  for (const id of ["a", "b"])
    p.receive(id, {
      type: "approval_request",
      toolCall: {
        payload: {
          tool_call_id: "tool-1",
          name: "exec_command",
          arguments: '{"cmd":"pwd"}',
        },
      },
    });
  assert.equal(p.pending.get("a:tool-1").title, "exec_command");
  p.receive("a", {
    type: "event_msg",
    payload: {
      type: "approval_decision",
      tool_call_id: "tool-1",
      decision: "deny",
    },
  });
  assert.equal(p.pending.size, 1);
  assert.ok(p.pending.has("b:tool-1"));
});

test("desktop restart of a previously mobile-owned turn is not shown as complete", async () => {
  const c = new Codex("test", "/tmp");
  c.owned.add("a");
  c.onMessage({
    method: "turn/started",
    params: { threadId: "a", turn: { id: "first" } },
  });
  c.onMessage({
    method: "turn/completed",
    params: { threadId: "a", turn: { id: "first", status: "completed" } },
  });
  c.projects = async () => [];
  c.projectFor = () => "/tmp";
  c.log = async () => ({
    status: "running",
    turnId: "desktop-turn",
    messages: [],
  });
  const s = await c.row({ id: "a", updatedAt: 1, cwd: "/tmp" }, true);
  assert.equal(s.status, "running");
  assert.equal(s.canReply, false);
  assert.equal(s.liveExternal, true);
});
test("explicit desktop project assignment wins over same-directory fallback", () => {
  const c = new Codex("test", "/profiles/two");
  c.projectCache = {
    data: [
      { id: "one", roots: ["/repo"] },
      { id: "two", roots: ["/repo"] },
    ],
    state: {
      "thread-project-assignments": { thread: { projectId: "old-two" } },
      "app-server-project-id-by-legacy-project-id-by-host": {
        "local:/profiles/two": { "old-two": "two" },
      },
    },
  };
  assert.equal(c.projectFor({ id: "thread", cwd: "/repo" }), "two");
  assert.equal(
    c.projectFor({ id: "new", cwd: "/repo", projectId: "two" }),
    "two",
  );
});
test("only lifecycle events finish a turn; tool output cannot spoof completion", () => {
  const s = { status: "unknown", messages: [] };
  codexFold(
    { type: "event_msg", payload: { type: "task_started", turn_id: "t1" } },
    s,
  );
  codexFold(
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        output: '{"type":"task_complete"}',
      },
    },
    s,
  );
  assert.equal(s.status, "running");
  codexFold(
    {
      type: "event_msg",
      timestamp: "2026-09-13T13:00:00Z",
      payload: { type: "task_complete" },
    },
    s,
  );
  assert.equal(s.status, "completed");
  assert.equal(s.completedAt, "2026-09-13T13:00:00Z");
  codexFold(
    { type: "event_msg", payload: { type: "task_started", turn_id: "t2" } },
    s,
  );
  assert.equal(s.status, "running");
  codexFold({ type: "event_msg", payload: { type: "turn_aborted" } }, s);
  assert.equal(s.status, "interrupted");
});
test("hide system messages, reasoning and tool payloads", () => {
  const s = { status: "unknown", messages: [] };
  for (const [role, channel] of [
    ["system", null],
    ["developer", null],
    ["assistant", "analysis"],
  ])
    codexFold(
      {
        type: "response_item",
        payload: {
          type: "message",
          role,
          channel,
          content: [{ type: "text", text: "private" }],
        },
      },
      s,
    );
  assert.equal(s.messages.length, 0);
  codexFold(
    {
      type: "response_item",
      ordinal: 1,
      payload: {
        type: "message",
        role: "assistant",
        channel: "final",
        content: [{ type: "output_text", text: "hello" }],
      },
    },
    s,
  );
  assert.equal(s.messages[0].text, "hello");
  assert.equal(
    textContent([
      { type: "reasoning", text: "hidden" },
      { type: "text", text: "visible" },
    ]),
    "visible",
  );
});
