import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClaudeDesktopRemote } from "../server/claude-desktop-remote.mjs";
test("cloud lists load metadata only and warm reads share one non-blocking refresh", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pokite-cloud-performance-"),
  );
  let now = 0,
    blocked = false,
    release,
    version = 0;
  const gate = new Promise((r) => (release = r)),
    calls = [];
  const row = (id) => ({
    id: "cse_" + id,
    title: "Title " + version,
    worker_status: "idle",
    status: "active",
    environment_kind: "anthropic_cloud",
    tags: ["cowork-remote"],
  });
  const client = {
    identity: async () => ({ account: "a", organization: "o" }),
    close: async () => {},
    request: async (route) => {
      calls.push(route);
      if (route.includes("/events"))
        return {
          data: [
            {
              sequence_num: "1",
              payload: {
                type: "assistant",
                uuid: "m",
                message: { content: "reply" },
              },
            },
          ],
          next_cursor: "earlier",
        };
      if (route.includes('/api/bootstrap/')) return {model_selector_config:[{id:'cowork',models:[{id:'fixture',name:'Fixture'}]}],model_selector_state:[{id:'cowork',model:'fixture'}]};
      if (blocked) await gate;
      if (route.includes("projects_v2"))
        return { data: [], pagination: { has_more: false } };
      if (route.includes("/sessions?"))
        return { data: [row("one"), row("two")] };
      return { session: row(route.split("cse_")[1]) };
    },
  };
  const a = new ClaudeDesktopRemote(root, { client, now: () => now });
  try {
    const projects = await a.projects();
    assert.equal(projects[0].name, "未分组");
    assert.equal(calls.length, 2);
    assert.equal(
      calls.some((r) => r.includes("/events")),
      false,
    );
    const id = "remote:a:o:cse_one";
    await Promise.all([a.detail(id), a.models(projects[0], id)]);
    assert.equal(
      calls.filter((r) => r === "/v1/code/sessions/cse_one").length,
      0,
    );
    assert.equal(calls.filter((r) => r.includes("/events")).length, 1);
    now = 6000;
    blocked = true;
    version = 1;
    const rows = await a.sessions(projects[0].id);
    assert.equal(rows[0].title, "Title 0");
    const pending = a.catalog.get();
    release();
    await pending;
    assert.equal((await a.sessions(projects[0].id))[0].title, "Title 1");
    assert.equal(calls.filter((r) => r.includes("/sessions?")).length, 2);
    assert.equal(calls.filter(r=>r.includes("projects_v2")).length,1);
  } finally {
    release();
    await a.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
