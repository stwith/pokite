import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PushService,
  completion,
  validateSubscription,
} from "../server/push.mjs";
import { notificationRoute } from "../src/lib/notification-route.js";

const subscription = {
  endpoint: "https://web.push.apple.com/fixture",
  keys: {
    auth: Buffer.alloc(16, 1).toString("base64url"),
    p256dh: Buffer.alloc(65, 2).toString("base64url"),
  },
};
test("push destinations cannot target private servers, arbitrary websites or credentials", () => {
  assert.equal(
    validateSubscription(subscription).endpoint,
    subscription.endpoint,
  );
  for (const endpoint of [
    "http://web.push.apple.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://web.push.apple.com.evil.test/x",
    "https://u:p@web.push.apple.com/x",
    "https://web.push.apple.com:8000/x",
  ])
    assert.throws(() => validateSubscription({ ...subscription, endpoint }));
  assert.throws(() => validateSubscription({ ...subscription, keys: {} }));
});
test("completion excludes old responses, cancellation, running, waiting and offline", () => {
  const detail = {
    status: "idle",
    messages: [
      { role: "user", text: "hello", time: 10000 },
      { role: "assistant", text: "done", time: 10001 },
    ],
  };
  assert.equal(completion(detail, 10000000), "completed");
  assert.equal(completion(detail, 20000000), null);
  for (const status of ["running", "waiting", "unknown", "interrupted"])
    assert.equal(completion({ ...detail, status }, 0), null);
  assert.equal(completion({ ...detail, offline: true }, 0), null);
  assert.equal(
    completion({ status: "failed", executionIssue: { message: "error" } }, 0),
    "failed",
  );
});
test("background monitor baselines history, notifies once, survives restart, and does not execute agents", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-push-"));
  let row = { id: "s", revision: "1", status: "idle" };
  let detail = {
    ...row,
    messages: [{ role: "assistant", text: "old", time: 1 }],
  };
  const sent = [];
  const adapter = {
    name: "Fixture",
    projects: async () => [{ id: "p" }],
    sessions: async () => [row],
    detail: async () => detail,
  };
  try {
    const service = new PushService(
      directory,
      { a: adapter },
      { send: async (s, p) => sent.push(p) },
    );
    await service.subscribe(subscription, "https://fixture.ts.net", "a", "p");
    await service.tick();
    assert.equal(sent.length, 0);
    row = { ...row, status: "running", revision: "2" };
    await service.tick();
    row = { ...row, status: "idle", revision: "3" };
    // Native metadata may settle before its transcript is persisted.
    await service.tick();
    assert.equal(sent.length, 0);
    detail = {
      ...row,
      messages: [
        {
          role: "assistant",
          text: "private response",
          time: new Date(Date.now() + 1000).toISOString(),
        },
      ],
    };
    await service.tick();
    assert.equal(sent.length, 1);
    assert.ok(!JSON.stringify(sent).includes("private response"));
    assert.ok(sent[0].url.includes("session=s"));
    await service.tick();
    assert.equal(sent.length, 1);
    const restarted = new PushService(
      directory,
      { a: adapter },
      { send: async (s, p) => sent.push(p) },
    );
    await restarted.tick();
    assert.equal(sent.length, 1);
    restarted.remove(subscription.endpoint);
    assert.equal(Object.keys(restarted.state.groups).length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("notification deep links are same-origin and contain all routing identifiers", () => {
  assert.deepEqual(
    notificationRoute(
      "https://host/?agent=codex&project=p&session=s",
      "https://host",
    ),
    { agent: "codex", project: "p", session: "s" },
  );
  assert.equal(
    notificationRoute(
      "https://evil/?agent=codex&project=p&session=s",
      "https://host",
    ),
    null,
  );
  assert.equal(
    notificationRoute("https://host/?agent=codex", "https://host"),
    null,
  );
});

test("automatic retries do not trigger failure notifications", () => {
  assert.equal(completion({status:"failed",executionIssue:{message:"retrying",retrying:true}}, 0), null);
});
