import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentConnections } from "../server/agent-connections.mjs";
import { claudeCodeDiagnostics } from "../server/claude-code-diagnostics.mjs";
import { acquireDesktopClient } from "../server/claude-desktop-client.mjs";

test("connection cache shares in-flight probes and never removes disconnected entries", async () => {
  let calls = 0,
    time = 0,
    online = false;
  const states = new AgentConnections(
    {},
    {
      now: () => time,
      probe: async () => {
        calls++;
        return { connected: online };
      },
    },
  );
  const instance = { id: "test" };
  const result = await Promise.all([
    states.get(instance, {}),
    states.get(instance, {}),
  ]);
  assert.equal(calls, 1);
  assert.equal(result[0].connected, false);
  online = true;
  assert.equal((await states.get(instance, {})).connected, false);
  time = 11000;
  assert.equal((await states.get(instance, {})).connected, true);
  assert.equal(calls, 2);
});
test("Code diagnostics expose causes without returning credential values or certifying account eligibility", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-diagnostics-"));
  try {
    await fs.mkdir(path.join(home, ".claude"));
    await fs.writeFile(
      path.join(home, ".claude/settings.json"),
      JSON.stringify({
        env: {
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          ANTHROPIC_BASE_URL: "https://gateway.invalid",
          ANTHROPIC_AUTH_TOKEN: "never-print-this",
        },
      }),
    );
    const notes = await claudeCodeDiagnostics({ home, env: {} });
    assert.equal(notes.length, 3);
    assert.match(notes.join(" "), /CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC/);
    assert.ok(!notes.join(" ").includes("never-print-this"));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
test("Desktop client leases share catalog loads and keep the remaining lease alive", async () => {
  const root = "/tmp/pokite-shared-catalog-fixture";
  const a = acquireDesktopClient(root),
    b = acquireDesktopClient(root);
  assert.equal(a.catalog, b.catalog);
  const original = a.catalog.client;
  a.catalog.client = {
    identity: async () => ({ account: "a", organization: "o" }),
  };
  let loads = 0;
  a.catalog.load = async () => {
    loads++;
    return { scope: "a:o", time: Date.now(), projects: [], rows: [] };
  };
  await Promise.all([a.catalog.get(), b.catalog.get()]);
  assert.equal(loads, 1);
  await a.close();
  assert.equal((await b.catalog.get()).rows.length, 0);
  assert.equal(loads, 1);
  a.catalog.client = original;
  await b.close();
  assert.equal(b.catalog.cached, null);
});
