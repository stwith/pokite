import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Claude } from "../server/claude.mjs";

test("Desktop sessions cannot be listed or resumed through CLI, including saved state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-owner-"));
  try {
    const owned = "11111111-1111-4111-8111-111111111111";
    const cli = "22222222-2222-4222-8222-222222222222";
    const dir = path.join(root, "claude-code-sessions/old-account/org");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "local_test.json"), JSON.stringify({ cliSessionId: owned, isArchived: true }));
    const file = path.join(root, "state.json");
    await fs.writeFile(file, JSON.stringify({ [owned]: { cwd: root, status: "completed" } }));
    let queries = 0;
    const adapter = new Claude({ listSessions: async () => [owned, cli].map(sessionId => ({ sessionId, cwd: root })), query() { queries++; } }, { desktopRoot: root, stateFile: pathToFileURL(file) });
    assert.deepEqual((await adapter.raw()).map(s => s.sessionId), [cli]);
    assert.deepEqual((await adapter.sessions(root)).map(s => s.id), [cli]);
    await assert.rejects(adapter.send(owned, "hello", "r"), /Claude Desktop/);
    assert.equal(queries, 0);
    assert.equal((await adapter.info(cli)).sessionId, cli);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
