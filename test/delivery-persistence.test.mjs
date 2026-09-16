import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Operations } from "../server/operations.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
const fixture = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "pocket-persistence-"));

test("failed initial operation save leaves no phantom pending receipt and same ID recovers", async () => {
  const root = fixture();
  try {
    const op = new Operations(path.join(root, "ops.json")),
      save = op.save.bind(op);
    let calls = 0;
    const action = async () => {
      calls++;
      return { accepted: true };
    };
    op.save = () => {
      throw Error("disk full");
    };
    await assert.rejects(op.run("fixture-request", {}, action), {
      delivery: "not-sent",
      status: 503,
    });
    assert.equal(calls, 0);
    assert.equal(op.records["fixture-request"], undefined);
    op.save = save;
    await op.run("fixture-request", {}, action);
    await new Operations(op.file).run("fixture-request", {}, action);
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed post-dispatch operation persistence never permits replay", async () => {
  const root = fixture();
  try {
    const op = new Operations(path.join(root, "ops.json")),
      save = op.save.bind(op);
    let calls = 0,
      writes = 0;
    op.save = () => {
      if (++writes > 1) throw Error("disk full");
      save();
    };
    await assert.rejects(
      op.run("fixture-request", {}, async () => {
        calls++;
        return { accepted: true };
      }),
    );
    await assert.rejects(
      new Operations(op.file).run("fixture-request", {}, async () => calls++),
    );
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("queue pre-dispatch write failure recovers without getting stuck sending", async () => {
  const root = fixture();
  try {
    let calls = 0;
    const q = new MessageQueue(path.join(root, "q.json"), {
      a: {
        detail: async () => ({ status: "idle" }),
        send: async () => {
          calls++;
          return { accepted: true };
        },
      },
    });
    q.add("a", "s", "hello", "request");
    const save = q.save.bind(q);
    let writes = 0;
    q.save = () => {
      if (++writes === 1) throw Error("disk full");
      save();
    };
    await q.tick();
    assert.equal(calls, 0);
    assert.equal(q.items[0].state, "queued");
    assert.equal(JSON.parse(fs.readFileSync(q.file))[0].state, "queued");
    q.save = save;
    await q.tick();
    assert.equal(calls, 1);
    assert.equal(q.items[0].state, "sent");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("queue post-send save failure becomes uncertain and blocks overtaking after restart", async () => {
  const root = fixture();
  try {
    let calls = 0;
    const adapters = {
      a: {
        detail: async () => ({ status: "idle" }),
        send: async () => {
          calls++;
          return { accepted: true };
        },
      },
    };
    const q = new MessageQueue(path.join(root, "q.json"), adapters);
    q.add("a", "s", "first", "r1");
    q.add("a", "s", "second", "r2");
    const save = q.save.bind(q);
    let writes = 0;
    q.save = () => {
      if (++writes === 2) throw Error("disk full");
      save();
    };
    await q.tick();
    assert.equal(calls, 1);
    assert.equal(q.items[0].state, "uncertain");
    q.save = save;
    await q.tick();
    await new MessageQueue(q.file, adapters).tick();
    assert.equal(calls, 1);
    assert.equal(q.items[1].state, "queued");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
