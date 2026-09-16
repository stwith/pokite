import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { loadInstances } from "../server/instances.mjs";

function launch(script, env, ipc = false) {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  return {
    child,
    result: once(child, "exit").then(([code]) => ({ code, stdout, stderr })),
  };
}
test("duplicate service startup cannot rewrite the existing queue", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-start-"));
  let first;
  try {
    const config = path.join(directory, "instances.json");
    await fs.writeFile(config, JSON.stringify({ instances: [] }));
    const env = {
      POCKET_STATE_DIR: directory,
      POCKET_CONFIG: config,
      PORT: "0",
    };
    first = launch("server/index.mjs", env, true);
    const timeout = setTimeout(() => first.child.kill("SIGTERM"), 10000);
    let message;
    try {
      message = await Promise.race([
        once(first.child, "message").then(([ready]) => ready),
        first.result.then((result) => {
          throw Error("Startup failed: " + result.stderr);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    assert.equal(message.type, "ready");
    const queue = '[{"state":"sending","requestId":"preserve"}]';
    await fs.writeFile(path.join(directory, "message-queue.json"), queue);
    const duplicate = await launch("scripts/start.mjs", env).result;
    assert.notEqual(duplicate.code, 0);
    assert.doesNotMatch(duplicate.stdout, /ready, PID/);
    assert.equal(
      await fs.readFile(path.join(directory, "message-queue.json"), "utf8"),
      queue,
    );
    first.child.kill("SIGTERM");
    assert.equal((await first.result).code, 0);
    await assert.rejects(fs.access(path.join(directory, "server.lock")));
  } finally {
    if (first?.child.exitCode === null) {
      first.child.kill("SIGTERM");
      await first.result;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("occupied port fails before queue initialization and never reports ready", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-port-"));
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const config = path.join(directory, "instances.json"),
      queue = '[{"state":"sending"}]';
    await fs.writeFile(config, JSON.stringify({ instances: [] }));
    await fs.writeFile(path.join(directory, "message-queue.json"), queue);
    const result = await launch("scripts/start.mjs", {
      POCKET_STATE_DIR: directory,
      POCKET_CONFIG: config,
      PORT: String(server.address().port),
    }).result;
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, /ready, PID/);
    assert.equal(
      await fs.readFile(path.join(directory, "message-queue.json"), "utf8"),
      queue,
    );
    await assert.rejects(fs.access(path.join(directory, "server.lock")));
  } finally {
    try {
      const state = JSON.parse(
        await fs.readFile(path.join(directory, "server-state.json"), "utf8"),
      );
      process.kill(state.pid, "SIGTERM");
    } catch {}
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("explicit missing configuration never falls back to default instances", () => {
  assert.throws(
    () => loadInstances("/missing/pocket-config-fixture.json"),
    /does not exist/,
  );
  assert.throws(() => loadInstances(""), /empty/);
});
test("background helper reports readiness only for a reachable initialized server", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-ready-"));
  let state;
  try {
    const config = path.join(directory, "instances.json");
    await fs.writeFile(config, JSON.stringify({ instances: [] }));
    const result = await launch("scripts/start.mjs", {
      POCKET_STATE_DIR: directory,
      POCKET_CONFIG: config,
      PORT: "0",
    }).result;
    state = JSON.parse(
      await fs.readFile(path.join(directory, "server-state.json"), "utf8"),
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /ready, PID/);
    const token = (
      await fs.readFile(path.join(directory, "access-token"), "utf8")
    ).trim();
    const response = await fetch(
      "http://127.0.0.1:" + state.port + "/api/agents",
      { headers: { Authorization: "Bearer " + token } },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  } finally {
    if (state) {
      process.kill(state.pid, "SIGTERM");
      for (let i = 0; i < 100; i++) {
        try {
          await fs.access(path.join(directory, "server.lock"));
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
