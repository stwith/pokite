import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";
import { Operations } from "../server/operations.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
const token = "isolated-http-test-token";
let base, server, directory, adapter, app;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-http-"));
  adapter = {
    projects: async () => [{ id: "project", path: directory }],
  };
  const adapters = { codex: adapter };
  app = createApp({
    adapters,
    agentNames: { codex: "Codex" },
    token,
    operations: new Operations(path.join(directory, "operations.json")),
    messages: new MessageQueue(path.join(directory, "queue.json"), adapters),
    reads: {},
    saveReads: () => {},
    dist: directory,
    getPort: () => server.address().port,
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  app?.locals.events.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
test("conditional GET returns no unchanged body and stream subscriptions release on disconnect", async () => {
  const headers = { Authorization: "Bearer " + token };
  const first = await fetch(base + "/api/codex/projects", { headers });
  const tag = first.headers.get("etag");
  await first.json();
  const unchanged = await fetch(base + "/api/codex/projects", {
    headers: { ...headers, "If-None-Match": tag },
  });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  const controller = new AbortController();
  const response = await fetch(base + "/api/codex/events", {
    headers,
    signal: controller.signal,
  });
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /ready/);
  assert.equal(app.locals.events.groups.size, 1);
  for (let i = 0; i < 20; i++) app.locals.events.notify("codex");
  const start = Date.now();
  assert.match(new TextDecoder().decode((await reader.read()).value), /change/);
  assert.ok(Date.now() - start < 1500);
  controller.abort();
  for (let i = 0; i < 50 && app.locals.events.groups.size; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(app.locals.events.groups.size, 0);
});
test("network gateway rejects unauthenticated and foreign origins", async () => {
  assert.equal((await fetch(base + "/api/agents")).status, 401);
  assert.equal(
    (
      await fetch(base + "/api/agents", {
        headers: {
          Authorization: "Bearer " + token,
          Origin: "http://evil.test",
        },
      })
    ).status,
    403,
  );
  const badHost = await new Promise((resolve, reject) => {
    http
      .get(
        base + "/api/agents",
        {
          headers: { Authorization: "Bearer " + token, Host: "evil.test:3230" },
        },
        (r) => {
          r.resume();
          resolve(r.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(badHost, 403);
  const r = await fetch(base + "/api/agents", {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(r.status, 200);
  const agents = await r.json();
  assert.deepEqual(
    agents.map(({ id, name }) => ({ id, name })),
    [{ id: "codex", name: "Codex" }],
  );
  assert.equal(agents[0].capabilities.nativeWithdraw, false);
  assert.equal((await fetch(base + "/.local/access-token")).status, 404);
});
test("unknown agents and empty prompts cannot launch work", async () => {
  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
  assert.equal(
    (await fetch(base + "/api/other/projects", { headers })).status,
    404,
  );
  const r = await fetch(base + "/api/codex/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: "",
      projectId: "/tmp",
      requestId: "invalid_path_test",
    }),
  });
  assert.equal(r.status, 400);
});

test("HTTP readers share overlapping detail calls but read acknowledgements revalidate", async () => {
  let calls = 0,
    arrived = 0,
    release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  adapter.detail = async (id) => {
    calls++;
    await pending;
    return {
      id,
      projectId: "project",
      status: "idle",
      revision: String(calls),
      messages: [],
    };
  };
  const observe = (req) => {
    if (
      req.method === "GET" &&
      req.url === "/api/codex/sessions/concurrent" &&
      ++arrived === 10
    )
      setImmediate(release);
  };
  server.on("request", observe);
  const timeout = setTimeout(release, 5000);
  try {
    const headers = {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    };
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetch(base + "/api/codex/sessions/concurrent", { headers }).then((r) =>
          r.json(),
        ),
      ),
    );
    assert.equal(arrived, 10);
    assert.equal(calls, 1);
    assert.ok(responses.every((r) => r.revision === "1"));
    const ack = await fetch(base + "/api/codex/sessions/concurrent/read", {
      method: "POST",
      headers,
      body: JSON.stringify({ revision: "1" }),
    });
    assert.deepEqual(await ack.json(), { ok: false });
    assert.equal(calls, 2);
  } finally {
    clearTimeout(timeout);
    server.off("request", observe);
  }
});
test("response body and ETag share one JSON serialization", async () => {
  const previous = adapter.projects;
  let serializations = 0;
  adapter.projects = async () => ({ toJSON() { serializations++; return [{ id: "snapshot" }]; } });
  try {
    const response = await fetch(base + "/api/codex/projects", { headers: { Authorization: "Bearer " + token } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ id: "snapshot" }]);
    assert.equal(serializations, 1);
    assert.ok(response.headers.get("etag"));
  } finally { adapter.projects = previous; }
});
