import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CoworkBroker } from "../server/cowork-broker.mjs";
function fakeProcess(reply) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdin.on("data", (data) => reply(JSON.parse(data), child));
  child.kill = () => queueMicrotask(() => child.emit("close", 0));
  return child;
}
test("broker client correlates requests and never needs a Desktop master key", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-broker-test-"));
  const binary = path.join(dir, "fixture");
  await fs.writeFile(binary, "");
  const seen = [];
  let launches = 0;
  const broker = new CoworkBroker({
    verify: async () => {},
    binary,
    launch: () => {
      launches++;
      return fakeProcess((request, child) => {
        seen.push(request);
        child.stdout.write(
          JSON.stringify({ id: request.id, result: { ok: true } }) + "\n",
        );
      });
    },
  });
  try {
    assert.deepEqual(
      await broker.request("/api/oauth/profile", { scope: "a:o" }),
      { ok: true },
    );
    await broker.request("/api/oauth/profile", { scope: "a:o" });
    assert.equal(launches, 1);
    assert.ok(seen.every((r) => !r.token && !r.key && !r.password));
  } finally {
    await broker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("lost broker response after a write is unknown and is never retried", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-broker-test-"));
  const binary = path.join(dir, "fixture");
  await fs.writeFile(binary, "");
  let sent = 0;
  const broker = new CoworkBroker({
    verify: async () => {},
    binary,
    timeout: 30,
    launch: () =>
      fakeProcess((r, c) => {
        sent++;
        c.stdout.write(JSON.stringify({ event: "started", id: r.id }) + "\n");
      }),
  });
  try {
    await assert.rejects(
      broker.request("/v1/code/sessions/cse_test/events", {
        method: "POST",
        scope: "a:o",
        body: {},
      }),
      { delivery: "unknown" },
    );
    assert.equal(sent, 1);
  } finally {
    await broker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("native authorization failures remain not-sent and point to macOS permission", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-broker-test-"));
  const binary = path.join(dir, "fixture");
  await fs.writeFile(binary, "");
  const broker = new CoworkBroker({
    verify: async () => {},
    binary,
    launch: () =>
      fakeProcess((r, c) =>
        c.stdout.write(
          JSON.stringify({
            id: r.id,
            error: {
              message: "Claude Safe Storage authorization required (-128)",
              status: 401,
              delivery: "not-sent",
            },
          }) + "\n",
        ),
      ),
  });
  try {
    await assert.rejects(
      broker.request("/api/oauth/profile"),
      (e) =>
        e.status === 401 &&
        e.delivery === "not-sent" &&
        e.message.includes("Mac"),
    );
  } finally {
    await broker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("a macOS authorization wait fails history reads promptly without cancelling the system prompt", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-broker-test-"));
  const binary = path.join(dir, "fixture");
  await fs.writeFile(binary, "");
  let sent = 0,
    child;
  const broker = new CoworkBroker({
    verify: async () => {},
    binary,
    launch: () =>
      (child = fakeProcess(() => {
        sent++;
        child.stdout.write(
          JSON.stringify({ event: "authorization", waiting: true }) + "\n",
        );
      })),
  });
  try {
    await assert.rejects(
      broker.request("/v1/code/sessions/cse_fixture", { scope: "a:o" }),
      { delivery: "not-sent", status: 503 },
    );
    await assert.rejects(
      broker.request("/v1/code/sessions/cse_fixture", { scope: "a:o" }),
      { delivery: "not-sent", status: 503 },
    );
    assert.equal(sent, 1);
    assert.ok(broker.child);
  } finally {
    await broker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("queued POST behind a blocked read is not-sent when the broker exits before starting it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-started-"));
  const binary = path.join(dir, "fixture");
  await fs.writeFile(binary, "");
  let child,
    seen = 0;
  const broker = new CoworkBroker({
    binary,
    verify: async () => {},
    timeout: 1000,
    launch: () =>
      (child = fakeProcess((r, c) => {
        seen++;
        if (r.method === "GET")
          c.stdout.write(JSON.stringify({ event: "started", id: r.id }) + "\n");
      })),
  });
  try {
    const first = broker.request("/api/oauth/profile").catch((e) => e);
    while (seen < 1) await new Promise((r) => setTimeout(r, 1));
    const second = broker
      .request("/v1/code/sessions/cse_test/events", {
        method: "POST",
        body: {},
      })
      .catch((e) => e);
    while (broker.pending.size < 2) await new Promise((r) => setTimeout(r, 1));
    assert.equal(seen, 1);
    child.kill();
    assert.equal((await first).delivery, "not-sent");
    assert.equal((await second).delivery, "not-sent");
  } finally {
    await broker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("unstarted POST times out as not-sent, while a started POST remains unknown", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-started-"));
  const binary = path.join(dir, "fixture");
  await fs.writeFile(binary, "");
  const broker = new CoworkBroker({
    binary,
    verify: async () => {},
    timeout: 20,
    launch: () => fakeProcess(() => {}),
  });
  try {
    await assert.rejects(
      broker.request("/v1/code/sessions/cse_test/events", {
        method: "POST",
        body: {},
      }),
      { delivery: "not-sent" },
    );
  } finally {
    await broker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("stdout started receipt arriving after process exit is drained before classifying a POST", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-drain-"));
  const binary = path.join(dir, "fixture");
  await fs.writeFile(binary, "");
  const broker = new CoworkBroker({
    binary,
    verify: async () => {},
    launch: () =>
      fakeProcess((r, c) => {
        queueMicrotask(() => {
          c.emit("exit", 1);
          c.stdout.write(JSON.stringify({ event: "started", id: r.id }) + "\n");
          c.emit("close", 1);
        });
      }),
  });
  try {
    await assert.rejects(
      broker.request("/v1/code/sessions/cse_test/events", {
        method: "POST",
        body: {},
      }),
      { delivery: "unknown" },
    );
  } finally {
    await broker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("local queue expiry never kills an active POST or writes the expired message", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-isolation-"));
  const binary = path.join(dir, "fixture");
  await fs.writeFile(binary, "");
  let child,
    active,
    kills = 0,
    sent = 0;
  const broker = new CoworkBroker({
    binary,
    verify: async () => {},
    timeout: 1000,
    queueTimeout: 30,
    launch: () => {
      child = fakeProcess((r, c) => {
        sent++;
        active = r;
        assert.ok(r.deadline > Date.now());
        c.stdout.write(JSON.stringify({ event: "started", id: r.id }) + "\n");
      });
      const kill = child.kill;
      child.kill = () => {
        kills++;
        kill();
      };
      return child;
    },
  });
  try {
    const first = broker.request("/v1/code/sessions/cse_test/events", {
      method: "POST",
      body: {},
    });
    while (!active) await new Promise((r) => setTimeout(r, 1));
    await assert.rejects(
      broker.request("/v1/code/sessions/cse_test/events", {
        method: "POST",
        body: {},
      }),
      { delivery: "not-sent" },
    );
    assert.equal(sent, 1);
    assert.equal(kills, 0);
    child.stdout.write(
      JSON.stringify({ id: active.id, result: { ok: true } }) + "\n",
    );
    assert.deepEqual(await first, { ok: true });
  } finally {
    await broker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("late started receipt during timeout shutdown is unknown, not safe to resend", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-late-start-"));
  const binary = path.join(dir, "fixture");
  await fs.writeFile(binary, "");
  let request;
  const broker = new CoworkBroker({
    binary,
    verify: async () => {},
    timeout: 20,
    launch: () => {
      const child = fakeProcess((r) => {
        request = r;
      });
      child.kill = () =>
        queueMicrotask(() => {
          child.stdout.write(
            JSON.stringify({ event: "started", id: request.id }) + "\n",
          );
          child.emit("close", 0);
        });
      return child;
    },
  });
  try {
    await assert.rejects(
      broker.request("/v1/code/sessions/cse_test/events", {
        method: "POST",
        body: {},
      }),
      { delivery: "unknown" },
    );
  } finally {
    await broker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
