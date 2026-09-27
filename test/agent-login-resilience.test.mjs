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

test("completed discovery fills missing enabled adapters and pauses after inactivity", async () => {
  let time = 0,
    calls = 0;
  const access = new AgentAccess({
    adapters: { unsaved: {}, disabled: { pokiteEnabled: false } },
    now: () => time,
  });
  access.report = async () => {
    calls++;
    return { candidates: [] };
  };
  try {
    access.refreshBackground();
    await access.refreshPending;
    assert.equal(access.cached("unsaved").notice, "检测失败");
    assert.equal(access.snapshot.has("disabled"), false);
    time = 600001;
    access.refreshBackground({ requested: false });
    assert.equal(calls, 1);
    access.refreshBackground();
    await access.refreshPending;
    assert.equal(calls, 2);
  } finally {
    access.close();
  }
});

test("force refresh during an active round schedules an immediate follow-up", async () => {
  let calls = 0,
    release;
  const gate = new Promise((r) => {
    release = r;
  });
  const access = new AgentAccess({ adapters: { a: {} }, now: () => 0 });
  access.report = async () => {
    calls++;
    if (calls === 1) await gate;
    return { candidates: [{ id: "a", connected: calls > 1 }] };
  };
  try {
    access.refreshBackground();
    const first = access.refreshPending;
    access.refreshBackground({ force: true });
    release();
    await first;
    await access.refreshPending;
    assert.equal(calls, 2);
    assert.equal(access.cached("a").connected, true);
  } finally {
    access.close();
  }
});

test("saved mobile toggle refreshes immediately despite the previous refresh deadline", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pokite-toggle-refresh-"),
  );
  const file = path.join(dir, "instances.json");
  const instance = { id: "claude", provider: "claude", name: "Claude" };
  await fs.writeFile(file, JSON.stringify({ instances: [instance] }));
  const adapter = { pokiteEnabled: false };
  let calls = 0;
  const access = new AgentAccess({
    adapters: { claude: adapter },
    agentNames: {},
    file,
    now: () => 0,
  });
  access.report = async () => {
    calls++;
    return { candidates: [{ id: "claude", connected: adapter.pokiteEnabled }] };
  };
  try {
    access.refreshBackground();
    await access.refreshPending;
    assert.equal(calls, 1);
    await access.toggle("claude", true, { configure: false });
    await access.refreshPending;
    assert.equal(calls, 2);
    assert.equal(access.cached("claude").connected, true);
  } finally {
    access.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
