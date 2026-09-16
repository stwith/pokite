import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Operations } from "../server/operations.mjs";
test("duplicate submissions execute once, including after a server restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-op-"));
  const file = path.join(dir, "ops.json");
  let n = 0;
  const op = new Operations(file);
  const action = async () => {
    n++;
    await new Promise((r) => setTimeout(r, 15));
    return { accepted: true };
  };
  await Promise.all([
    op.run("request_123456", {}, action),
    op.run("request_123456", {}, action),
  ]);
  assert.equal(n, 1);
  assert.deepEqual(
    await new Operations(file).run("request_123456", {}, action),
    { accepted: true },
  );
  assert.equal(n, 1);
  await assert.rejects(
    op.run("request_123456", { text: "changed" }, action),
    /reused/,
  );
  fs.rmSync(dir, { recursive: true });
});
test("an interrupted ambiguous write cannot be retried automatically", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-op-"));
  const file = path.join(dir, "ops.json");
  const op = new Operations(file);
  await assert.rejects(
    op.run("request_abcdef", {}, async () => {
      throw Error("timeout after dispatch");
    }),
    /timeout/,
  );
  await assert.rejects(
    new Operations(file).run("request_abcdef", {}, async () => {
      assert.fail("must not run");
    }),
    /timeout/,
  );
  fs.rmSync(dir, { recursive: true });
});
test("a connection failure before dispatch can retry the same request id", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-op-"));
  try {
    const file = path.join(dir, "ops.json"),
      op = new Operations(file);
    await assert.rejects(
      op.run("request_not_sent", {}, async () => {
        throw Object.assign(Error("not connected"), { delivery: "not-sent" });
      }),
    );
    assert.deepEqual(
      await new Operations(file).run("request_not_sent", {}, async () => ({
        accepted: true,
      })),
      { accepted: true },
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
