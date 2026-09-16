import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Penguin } from "../server/adapters.mjs";
test("temporary workspaces aggregate without changing native session paths", async () => {
  const p = new Penguin();
  const root = path.join(
    process.env.HOME,
    ".penguin/data/p/agents/default_agent/workspaces",
  );
  const a = {
    sessionId: "one",
    projectId: "p",
    agentId: "default_agent",
    workspace: root + "/tmp-abcd",
    status: "idle",
  };
  const b = { ...a, sessionId: "two", workspace: root + "/tmp-cdef" };
  const c = {
    ...a,
    sessionId: "three",
    agentId: "mini",
    workspace: root + "/tmp-abcd",
  };
  const real = {
    ...a,
    sessionId: "four",
    workspace: "/Users/example/Codes/tmp-abcd",
  };
  p.raw = async () => [a, b, c, real];
  const projects = await p.projects();
  assert.equal(projects.length, 3);
  assert.equal(projects[0].temporary, false);
  assert.equal(projects.filter((x) => x.temporary).length, 2);
  assert.equal(p.projectId(a), p.projectId(b));
  assert.notEqual(p.projectId(a), p.projectId(c));
  assert.equal(p.row(a).workspace, a.workspace);
  assert.equal((await p.sessions(p.projectId(a))).length, 2);
  assert.equal(projects.find((x) => x.temporary).canCreate, false);
});
