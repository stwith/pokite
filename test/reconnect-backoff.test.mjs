import test from "node:test";
import assert from "node:assert/strict";
import { createReconnectBackoff } from "../src/lib/reconnect-backoff.js";
test("reconnect grows exponentially, caps at 30 seconds and resets explicitly", () => {
  const retry = createReconnectBackoff(() => 0);
  assert.deepEqual(
    Array.from({ length: 8 }, () => retry.next()),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000],
  );
  retry.reset();
  assert.equal(retry.next(), 1000);
});
test("jitter avoids synchronized reconnects without exceeding the cap", () => {
  const retry = createReconnectBackoff(() => 1);
  assert.deepEqual(
    Array.from({ length: 7 }, () => retry.next()),
    [1200, 2400, 4800, 9600, 19200, 30000, 30000],
  );
});
