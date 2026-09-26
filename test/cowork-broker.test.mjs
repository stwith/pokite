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
  child.kill = () => queueMicrotask(() => child.emit("exit", 0));
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
      fakeProcess(() => {
        sent++;
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
