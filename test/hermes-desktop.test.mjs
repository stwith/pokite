import test from "node:test";
import assert from "node:assert/strict";
import { HermesDesktop } from "../server/hermes-desktop.mjs";

const stored = {
  id: "stored",
  profile: "default",
  cwd: "/project",
  title: "Test",
  message_count: 1,
  started_at: 1,
};
const id = Buffer.from(JSON.stringify(["default", "stored"])).toString(
  "base64url",
);
function fixture(status = "idle") {
  const calls = [];
  const adapter = new HermesDesktop("/fixture");
  adapter.rows = () => [stored];
  const client = {
    endpoint: { profile: "default" },
    async get(route) {
      calls.push(route);
      if (route === "/api/plugins/pokite/sessions")
        return {
          version: 1,
          sessions:
            status === "missing"
              ? []
              : [
                  {
                    id: "runtime",
                    session_key: "stored",
                    status,
                    inflight:
                      status === "failed" ? { error: "HTTP 503" } : null,
                  },
                ],
        };
      return {
        messages: [
          { id: 1, role: "user", content: "hello", timestamp: 1 },
          { id: 2, role: "tool", content: "private tool result" },
        ],
      };
    },
    async post(route, body) {
      calls.push([route, body]);
      return { status: "streaming" };
    },
  };
  adapter.connections = async () => [client];
  return { adapter, calls };
}
test("Hermes sends via owner-preserving plugin, never resumes or opens another executor", async () => {
  const { adapter, calls } = fixture();
  assert.equal((await adapter.send(id, "phone")).accepted, true);
  assert.deepEqual(calls.at(-1), [
    "/api/plugins/pokite/send",
    { session_id: "runtime", text: "phone" },
  ]);
  assert.ok(!JSON.stringify(calls).includes("session.resume"));
});
test("Hermes cold and busy sessions cannot steal Desktop ownership", async () => {
  for (const state of ["missing", "working", "starting", "waiting"]) {
    const { adapter, calls } = fixture(state);
    await assert.rejects(adapter.send(id, "phone"));
    assert.ok(calls.every((call) => typeof call === "string"));
  }
});
test("Hermes reports native failure and hides tool messages", async () => {
  const { adapter } = fixture("failed");
  const detail = await adapter.detail(id);
  assert.equal(detail.status, "failed");
  assert.equal(detail.executionIssue.message, "HTTP 503");
  assert.deepEqual(
    detail.messages.map((m) => m.text),
    ["hello"],
  );
});
test("Hermes identifies inactive history as read-only and validates history cursors", async () => {
  const { adapter } = fixture("missing");
  assert.equal((await adapter.detail(id)).readOnly, true);
  await assert.rejects(adapter.history(id, "-1"));
  await assert.rejects(adapter.history(id, "NaN"));
});
