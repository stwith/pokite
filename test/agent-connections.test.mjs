import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentConnections } from "../server/agent-connections.mjs";
import { ClaudeCloudCatalog } from "../server/claude-cloud-catalog.mjs";
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
  time = 46000;
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

test("Claude status probes never fetch profiles or cloud catalogs", async () => {
  const home = await fs.mkdtemp(
    path.join(os.tmpdir(), "pokite-passive-status-"),
  );
  try {
    await fs.writeFile(
      path.join(home, "config.json"),
      JSON.stringify({ lastKnownAccountUuid: "a" }),
    );
    const adapter = {
      catalog: {
        cached: {
          scope: "a:o",
          time: Date.now(),
          rows: [
            {
              codeLocalId: "local",
              native: { connection_status: "connected" },
            },
          ],
        },
        get: () => assert.fail("status must not fetch"),
      },
      raw: () => assert.fail("status must not fetch"),
    };
    const connections = new AgentConnections({
      code: adapter,
      cowork: adapter,
    });
    const report = { apps: [{ provider: "claudeDesktop", running: true }] };
    assert.equal(
      (
        await connections.get(
          { id: "code", provider: "claudeDesktopCode", home },
          report,
        )
      ).connected,
      true,
    );
    assert.equal(
      (
        await connections.get(
          { id: "cowork", provider: "claudeDesktop", home },
          report,
        )
      ).connected,
      true,
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("Claude Desktop reads as connected unless something is known to be wrong", async () => {
  const home = await fs.mkdtemp(
    path.join(os.tmpdir(), "pokite-claude-status-"),
  );
  try {
    await fs.writeFile(
      path.join(home, "config.json"),
      JSON.stringify({ lastKnownAccountUuid: "a" }),
    );
    const now = Date.now();
    const catalog = {
      cached: null,
      get: () => assert.fail("status must not fetch"),
    };
    const adapter = { catalog };
    const report = { apps: [{ provider: "claudeDesktop", running: true }] };
    const check = (provider) =>
      new AgentConnections({ x: adapter }).inspect(
        { id: "x", provider, home },
        report,
      );
    // Nothing browsed yet (e.g. right after a restart): no warning.
    assert.deepEqual(await check("claudeDesktop"), { connected: true });
    assert.equal((await check("claudeDesktopCode")).connected, true);
    // Code without any Remote Control session, seen 20 minutes ago, still counts.
    catalog.cached = { scope: "a:o", time: now - 20 * 60000, rows: [] };
    assert.equal((await check("claudeDesktopCode")).connected, false);
    // After 30 minutes that observation is too old to warn about.
    catalog.cached.time = now - 40 * 60000;
    assert.equal((await check("claudeDesktopCode")).connected, true);
    // The latest real read failed: report it.
    catalog.failure = {
      time: now,
      message: "Claude 登录已过期，请在 Claude Desktop 重新登录",
    };
    const failed = await check("claudeDesktop");
    assert.equal(failed.connected, false);
    assert.match(failed.notice, /登录已过期/);
    // A later success supersedes the failure.
    catalog.cached = { scope: "a:o", time: now + 1, rows: [] };
    assert.deepEqual(await check("claudeDesktop"), { connected: true });
    // Desktop not running is still reported.
    assert.equal(
      (
        await new AgentConnections({ x: adapter }).inspect(
          { id: "x", provider: "claudeDesktop", home },
          { apps: [] },
        )
      ).connected,
      false,
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("the Claude catalog remembers its latest read failure until a success", async () => {
  let fail = true;
  const catalog = new ClaudeCloudCatalog("/tmp/pokite-catalog-failure", {
    identity: async () => ({ account: "a", organization: "o" }),
  });
  catalog.load = async () => {
    if (fail) throw Error("cloud unavailable");
    return { scope: "a:o", time: Date.now(), projects: [], rows: [] };
  };
  await assert.rejects(catalog.get({ fresh: true }), /cloud unavailable/);
  assert.equal(catalog.failure.message, "cloud unavailable");
  fail = false;
  await catalog.get({ fresh: true });
  assert.equal(catalog.failure, null);
});
