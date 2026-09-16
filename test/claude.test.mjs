import test from "node:test";
import assert from "node:assert/strict";
import { Claude } from "../server/claude.mjs";
const id = "12345678-1234-1234-1234-123456789012";
test("Claude exposes SDK retries while running and clears them after success", async () => {
  const { c } = harness();
  let release, ready;
  const observed = new Promise(r => { ready = r; });
  c.sdk.query = () => Object.assign((async function* () {
    yield {type:"system",subtype:"api_retry",session_id:id,attempt:2,max_retries:10,retry_delay_ms:3000,error_status:503};
    ready();
    await new Promise(r=>{release=r;});
    yield {type:"result",session_id:id,is_error:false};
  })(),{close(){}});
  c.states[id]={cwd:"/tmp",status:"running",updatedAt:1};
  c.jobs.set(id,{});
  const work=c.drive(id,"hello",null,new AbortController());
  await observed;
  const detail=await c.detail(id);
  assert.equal(detail.executionIssue.retrying,true);
  assert.match(detail.executionIssue.message,/503.*2\/10/);
  release(); await work;
  assert.equal((await c.detail(id)).executionIssue,null);
});
const native = {
  sessionId: id,
  cwd: "/tmp",
  summary: "Existing",
  lastModified: 1,
  fileSize: 1,
};
function harness(messages = []) {
  const calls = [];
  const sdk = {
    listSessions: async () => [native],
    getSessionMessages: async () => messages,
    query: ({ options }) => {
      calls.push(options);
      const chosen = options.resume || options.sessionId;
      return Object.assign(
        (async function* () {
          yield {
            type: "system",
            subtype: "init",
            session_id: chosen,
            model: "sonnet",
          };
          yield {
            type: "assistant",
            parent_tool_use_id: "child",
            session_id: "another-session",
          };
          yield { type: "result", session_id: chosen, is_error: false };
        })(),
        { close() {} },
      );
    },
  };
  const c = new Claude(sdk);
  c.states = {};
  c.save = () => {};
  return { c, calls };
}
async function done(c) {
  for (let i = 0; i < 30 && c.jobs.size; i++)
    await new Promise((r) => setTimeout(r, 1));
  assert.equal(c.jobs.size, 0);
}
test("Claude continues the original session without a fork", async () => {
  const { c, calls } = harness([
    {
      type: "assistant",
      uuid: "m",
      message: {
        model: "sonnet",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "done" }],
      },
    },
  ]);
  await c.send(id, "continue", "request", { model: "sonnet" });
  await done(c);
  assert.equal(calls[0].resume, id);
  assert.equal(calls[0].sessionId, undefined);
  assert.equal(calls[0].model, "sonnet");
  assert.equal(c.states[id].status, "completed");
});
test("Claude creation uses the preallocated session identity", async () => {
  const { c, calls } = harness();
  const session = await c.create({ path: "/tmp" });
  await c.send(session.id, "hello", "request");
  await done(c);
  assert.equal(calls[0].sessionId, session.id);
  assert.equal(calls[0].resume, undefined);
});
test("Claude synthetic API failures are not labeled complete", async () => {
  const { c } = harness([
    {
      type: "assistant",
      uuid: "e",
      message: {
        model: "<synthetic>",
        stop_reason: "stop_sequence",
        content: [{ type: "text", text: "API Error: 503 unavailable" }],
      },
    },
  ]);
  assert.equal((await c.detail(id)).status, "failed");
});
test("Claude approvals retain input and require an explicit decision", async () => {
  const { c } = harness();
  const controller = new AbortController();
  const result = c.ask(
    id,
    "Bash",
    { command: "pwd" },
    { signal: controller.signal },
  );
  const [key] = c.pending.keys();
  await c.answer(id, key, { allow: false });
  assert.equal((await result).behavior, "deny");
  assert.equal(c.pending.size, 0);
});
