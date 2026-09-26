import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createApp } from "../server/app.mjs";
import { rotateAccessToken } from "../server/access-token.mjs";
import express from "express";
import { installHttpProtection } from "../server/http-middleware.mjs";

test("one persistent code supports repeated remote login; reset is local-only and invalidates old code", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-shared-"));
  let token = "fixture-shared-code",
    server;
  const app = createApp({
    adapters: {},
    agentNames: {},
    getToken: () => token,
    resetAccess: () => (token = rotateAccessToken(dir)),
    messages: {},
    operations: {},
    reads: {},
    saveReads() {},
    dist: dir,
    getPort: () => server.address().port,
  });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (route, code = token, remote = false, body) =>
    fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + code,
        ...(remote ? { "X-Forwarded-For": "100.64.1.2" } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    for (let i = 0; i < 4; i++)
      assert.equal((await request("/agents", token, true)).status, 200);
    assert.equal(
      (await (await request("/connection-links", token, true)).json())
        .accessToken,
      token,
    );
    assert.equal(
      (
        await request("/setup/toggle", token, true, {
          instanceId: "fixtureUnknownAgent",
          enabled: false,
        })
      ).status,
      403,
    );
    assert.equal((await request("/auth/reset", token, true, {})).status, 403);
    assert.equal((await request("/auth/pair", token, true, {})).status, 404);
    const old = token;
    const reset = await request("/auth/reset", old, false, {});
    assert.equal(reset.status, 200);
    const next = (await reset.json()).token;
    assert.notEqual(next, old);
    assert.equal(fs.readFileSync(path.join(dir, "access-token"), "utf8"), next);
    assert.equal((await request("/agents", old, true)).status, 401);
    assert.equal((await request("/auth/reset", old, false, {})).status, 401);
    assert.equal((await request("/agents", next, true)).status, 200);
  } finally {
    app.locals.events.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reset closes streams authenticated with the previous code", async () => {
  let token = "first";
  const app = express(),
    server = http.createServer(app);
  installHttpProtection(app, {
    getToken: () => token,
    getPort: () => server.address().port,
  });
  app.get("/api/demo/events", (_, res) => {
    res.type("text/event-stream").write("data: ready\n\n");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/demo/events`,
      {
        headers: { Authorization: "Bearer first" },
        signal: AbortSignal.timeout(5000),
      },
    );
    const reader = response.body.getReader();
    assert.equal((await reader.read()).done, false);
    token = "second";
    assert.equal((await reader.read()).done, true);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test("offline reset replaces the code, clears notifications and refuses an active service lock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-reset-"));
  const env = { ...process.env, POKITE_STATE_DIR: dir };
  try {
    fs.writeFileSync(path.join(dir, "access-token"), "old");
    fs.writeFileSync(
      path.join(dir, "push.json"),
      JSON.stringify({
        vapid: { fixture: true },
        devices: { old: {} },
        outbox: [{}],
      }),
    );
    execFileSync(process.execPath, ["scripts/rotate-token.mjs"], {
      env,
      stdio: "pipe",
    });
    const code = fs.readFileSync(path.join(dir, "access-token"), "utf8");
    assert.notEqual(code, "old");
    const push = JSON.parse(
      fs.readFileSync(path.join(dir, "push.json"), "utf8"),
    );
    assert.deepEqual(push.devices, {});
    assert.deepEqual(push.outbox, []);
    assert.equal(push.vapid.fixture, true);
    fs.writeFileSync(path.join(dir, "server.lock"), "occupied");
    assert.throws(() =>
      execFileSync(process.execPath, ["scripts/rotate-token.mjs"], {
        env,
        stdio: "pipe",
      }),
    );
    assert.equal(fs.readFileSync(path.join(dir, "access-token"), "utf8"), code);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
