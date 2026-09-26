import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentAccess } from "../server/agent-access.mjs";
import { loadInstances } from "../server/instances.mjs";
import {
  generateAccessToken,
  matchesAccessToken,
} from "../server/access-token.mjs";
import { AccessThrottle } from "../server/access-throttle.mjs";
import { parsePairingQR } from "../src/lib/pairing-qr.js";

test("agent switches persist access, preserve active adapters and report only actionable notices", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-switch-"));
  const file = path.join(dir, "instances.json");
  const instance = { id: "codex", provider: "codex", name: "Codex", home: dir };
  const running = { acceptedTask: true };
  const adapters = { codex: running },
    agentNames = { codex: "Codex" };
  const access = new AgentAccess({
    adapters,
    agentNames,
    file,
    discover: async () => ({
      instances: [instance],
      candidates: [{ ...instance, status: "sharing-configured" }],
    }),
    create: () => assert.fail("must reuse existing adapter"),
    prepare: async () => "",
  });
  try {
    await fs.writeFile(file, JSON.stringify({ instances: [instance] }));
    await access.toggle("codex", false);
    assert.equal(adapters.codex, running);
    assert.equal(running.acceptedTask, true);
    assert.equal(running.pokiteEnabled, false);
    assert.deepEqual(loadInstances(file), []);
    assert.equal(
      loadInstances(file, { includeDisabled: true })[0].enabled,
      false,
    );
    let report = await access.report();
    assert.equal(report.candidates[0].enabled, false);
    assert.equal(report.candidates[0].status, undefined);
    assert.equal(typeof report.candidates[0].connected, "boolean");
    await access.toggle("codex", true);
    assert.equal(running.pokiteEnabled, true);
    assert.equal(loadInstances(file).length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("failed setup restores stored configuration and never exposes a half-enabled agent", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-switch-fail-"));
  const file = path.join(dir, "instances.json");
  const instance = { id: "codex", provider: "codex", name: "Codex", home: dir };
  const adapters = {},
    agentNames = {};
  const access = new AgentAccess({
    adapters,
    agentNames,
    file,
    discover: async () => ({ instances: [instance], candidates: [instance] }),
    create: () => ({}),
    prepare: async () => {
      throw Error("setup failed");
    },
  });
  try {
    await assert.rejects(access.toggle("codex", true), /setup failed/);
    assert.deepEqual(adapters, {});
    await assert.rejects(fs.access(file), { code: "ENOENT" });
    await assert.rejects(access.toggle("unknown", true), { status: 404 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("short access codes avoid ambiguous characters and remain valid QR credentials", () => {
  const codes = new Set(Array.from({ length: 100 }, generateAccessToken));
  assert.equal(codes.size, 100);
  for (const code of codes) {
    assert.match(code, /^[A-HJ-NP-Z2-9]{20}$/);
    assert.equal(
      parsePairingQR(
        "http://localhost:3230/#token=" + code,
        "http://localhost:3230",
      ).token,
      code,
    );
  }
});
test("repeated wrong access codes are throttled and recover after a minute", () => {
  let time = 0;
  const throttle = new AccessThrottle(() => time);
  for (let i = 0; i < 10; i++) throttle.failed("phone");
  assert.equal(throttle.blocked("phone"), true);
  assert.equal(throttle.blocked("other"), false);
  time = 60001;
  assert.equal(throttle.blocked("phone"), false);
  throttle.failed("phone");
  throttle.succeeded("phone");
  assert.equal(throttle.failures.has("phone"), false);
});

test("short codes accept lowercase and grouped input without weakening legacy code comparison", () => {
  assert.equal(
    matchesAccessToken("abcd2 efgh3 jklm4 npqr5", "ABCD2EFGH3JKLM4NPQR5"),
    true,
  );
  assert.equal(
    matchesAccessToken("abcd2-efgh3-jklm4-npqr5", "ABCD2EFGH3JKLM4NPQR5"),
    true,
  );
  assert.equal(
    matchesAccessToken("abcd2-efgh3-jklm4-npqr6", "ABCD2EFGH3JKLM4NPQR5"),
    false,
  );
  assert.equal(matchesAccessToken("LEGACY-secret", "legacy-secret"), false);
});

test("mobile visibility changes never run privileged installation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-mobile-switch-"));
  const instance = {
    id: "claudeDesktopCode",
    provider: "claudeDesktopCode",
    name: "Claude Desktop Code",
    home: dir,
  };
  const adapters = {};
  const access = new AgentAccess({
    adapters,
    agentNames: {},
    file: path.join(dir, "instances.json"),
    discover: async () => ({ instances: [instance], candidates: [instance] }),
    create: () => ({}),
    prepare: async () => assert.fail("remote toggle must not run setup"),
  });
  try {
    await access.toggle(instance.id, true, { configure: false });
    assert.equal(adapters[instance.id].pokiteEnabled, true);
    await access.toggle(instance.id, false, { configure: false });
    assert.equal(adapters[instance.id].pokiteEnabled, false);
    assert.equal(loadInstances(path.join(dir, "instances.json")).length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
