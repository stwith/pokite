import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app.mjs";
import { AgentAccess } from "../server/agent-access.mjs";

for (const mode of ["failure", "pending"])
  test(`login remains available during discovery ${mode}`, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-login-"));
    const instance = {
      id: "fixture",
      provider: "codex",
      name: "Fixture",
      home: dir,
    };
    const file = path.join(dir, "instances.json");
    await fs.writeFile(file, JSON.stringify({ instances: [instance] }));
    let calls = 0,
      release,
      changes = 0;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const app = createApp({
      adapters: { fixture: { provider: "codex" } },
      agentNames: { fixture: "Fixture" },
      token: "fixture-code",
      messages: {},
      operations: {},
      reads: {},
      saveReads() {},
      dist: dir,
      getPort: () => server.address().port,
      events: {
        broadcast() {
          changes++;
        },
        close() {},
      },
      agentAccessOptions: {
        file,
        discover: async () => {
          calls++;
          if (mode === "pending") await gate;
          throw Error("discovery boom");
        },
      },
    });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const get = () =>
        fetch(`http://127.0.0.1:${server.address().port}/api/agents`, {
          headers: { Authorization: "Bearer fixture-code" },
          signal: AbortSignal.timeout(1500),
        });
      const responses = await Promise.all(Array.from({ length: 5 }, get));
      for (const response of responses) {
        assert.equal(response.status, 200);
        const rows = await response.json();
        assert.equal(rows[0].id, "fixture");
        assert.equal(rows[0].connected, null);
      }
      assert.equal(calls, 1);
      release();
      await app.locals.agentAccess.refreshPending;
      assert.equal(app.locals.agentAccess.cached("fixture").notice, "检测失败");
      assert.equal(changes, 1);
      const report = await app.locals.agentAccess.report();
      assert.equal(report.candidates[0].id, "fixture");
      assert.equal(report.candidates[0].notice, "检测失败");
    } finally {
      release();
      app.locals.agentAccess.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

test("remote toggles cannot register discovered but unsaved instances", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pokite-visibility-only-"),
  );
  const file = path.join(dir, "instances.json");
  await fs.writeFile(file, JSON.stringify({ instances: [] }));
  const access = new AgentAccess({
    adapters: {},
    agentNames: {},
    file,
    discover: () => assert.fail("remote toggle must not discover"),
    create: () => assert.fail("remote toggle must not instantiate"),
    prepare: () => assert.fail("remote toggle must not install"),
  });
  try {
    await assert.rejects(
      access.toggle("newAgent", true, { configure: false }),
      { status: 403 },
    );
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
      instances: [],
    });
  } finally {
    access.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
