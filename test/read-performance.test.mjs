import test from "node:test";
import assert from "node:assert/strict";
import { ReadCoordinator } from "../server/read-coordinator.mjs";
import { WeightedCache } from "../server/weighted-cache.mjs";

test("ten simultaneous reads share one operation, settled values stay fresh", async () => {
  const reads = new ReadCoordinator();
  let calls = 0,
    release;
  const load = () => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = Array.from({ length: 10 }, () =>
    reads.run(["codex", "detail", "s"], load),
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  release({ revision: 1 });
  assert.deepEqual(await Promise.all(pending), Array(10).fill({ revision: 1 }));
  assert.equal(reads.pending.size, 0);
  assert.deepEqual(
    await reads.run(["codex", "detail", "s"], () => ({ revision: 2 })),
    { revision: 2 },
  );
});

test("read keys isolate instances and arguments, failed reads can retry", async () => {
  const reads = new ReadCoordinator();
  const results = await Promise.all([
    reads.run(["a", "sessions", { limit: 40 }], () => 1),
    reads.run(["b", "sessions", { limit: 40 }], () => 2),
    reads.run(["a", "sessions", { limit: 80 }], () => 3),
  ]);
  assert.deepEqual(results, [1, 2, 3]);
  await assert.rejects(
    reads.run(["fail"], () => {
      throw Error("offline");
    }),
  );
  assert.equal(await reads.run(["fail"], () => "online"), "online");
  assert.equal(reads.pending.size, 0);
});

test("weighted cache evicts least recently used entries and rejects oversized entries", () => {
  const cache = new WeightedCache({
    maxWeight: 10,
    maxEntries: 2,
    weigh: (value) => value,
  });
  cache.set("a", 4);
  cache.set("b", 4);
  assert.equal(cache.get("a"), 4);
  cache.set("c", 4);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.weight, 8);
  cache.set("c", 7);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.weight, 7);
  cache.set("huge", 11);
  assert.equal(cache.get("huge"), undefined);
  cache.clear();
  assert.equal(cache.weight, 0);
  assert.equal(cache.size, 0);
});
