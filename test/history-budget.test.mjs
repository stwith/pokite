import test from "node:test";
import assert from "node:assert/strict";
import { Claude } from "../server/claude.mjs";
test("Claude oversized histories remain readable without being retained", async () => {
  let reads = 0;
  const messages = [
    { type: "assistant", message: { content: "long history" } },
  ];
  const c = new Claude(
    {
      getSessionMessages: async () => {
        reads++;
        return messages;
      },
    },
    { historyCacheBytes: 1 },
  );
  const info = {
    sessionId: "fixture",
    cwd: "/tmp",
    lastModified: 1,
    fileSize: 10,
  };
  assert.deepEqual(await c.messages(info), messages);
  assert.deepEqual(await c.messages(info), messages);
  assert.equal(reads, 2);
  assert.equal(c.historyCache.size, 0);
  c.close();
});
