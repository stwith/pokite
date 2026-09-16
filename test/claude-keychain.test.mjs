import test from "node:test";
import assert from "node:assert/strict";
import { keychainHelperPath, readClaudeKeychain } from "../server/claude-keychain.mjs";

test("Claude helper uses a fixed executable and returns only an in-memory copy", async () => {
  const stdout = Buffer.from("fixture-secret");
  const signal = new AbortController().signal;
  const key = await readClaudeKeychain(signal, async (binary, args, options) => {
    assert.equal(binary, keychainHelperPath());
    assert.deepEqual(args, []);
    assert.equal(options.signal, signal);
    assert.equal(options.encoding, "buffer");
    return { stdout };
  });
  assert.equal(key.toString(), "fixture-secret");
  assert.ok(stdout.every(byte => byte === 0));
  key.fill(0);
});

test("Claude helper failures never expose captured credentials or fall back to security", async () => {
  const stdout = Buffer.from("private-fixture");
  let calls = 0;
  await assert.rejects(readClaudeKeychain(undefined, async () => {
    calls++;
    throw Object.assign(new Error("private-fixture"), { stdout, stderr: "private-fixture", code: 77 });
  }), error => error.status === 503 && !error.message.includes("private-fixture") && !error.stdout);
  assert.equal(calls, 1);
  assert.ok(stdout.every(byte => byte === 0));
});

test("missing helper provides an installation action", async () => {
  await assert.rejects(readClaudeKeychain(undefined, async () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  }), /setup-claude-keychain/);
});
