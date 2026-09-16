import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Claude } from "../server/claude.mjs";
import { ClaudeDesktop } from "../server/claude-desktop.mjs";
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
test("Desktop history pagination does not depend on cache admission", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pocket-history-budget-"),
  );
  try {
    const audit = path.join(root, "audit.jsonl");
    await fs.writeFile(
      audit,
      Array.from({ length: 100 }, (_, i) =>
        JSON.stringify({
          type: "assistant",
          uuid: String(i),
          message: { content: "message " + i },
        }),
      ).join("\n"),
    );
    const c = new ClaudeDesktop(root, { historyCacheBytes: 1 });
    c.raw = async () => [
      { id: "s", projectId: "local-agent:test", audit, revision: "1" },
    ];
    const detail = await c.detail("s");
    assert.equal(detail.messages.length, 80);
    assert.equal(detail.historyCursor, "20");
    assert.equal(c.details.size, 0);
    const history = await c.history("s", detail.historyCursor);
    assert.equal(history.messages.length, 20);
    assert.equal(history.messages[0].id, "0");
    assert.equal(c.details.size, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
