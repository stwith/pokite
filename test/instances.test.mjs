import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultInstances,
  validateInstances,
  capabilities,
} from "../server/instances.mjs";
import { matchesProcessGeneration } from "../server/process-identity.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CodexReadOnly } from "../server/codex-readonly.mjs";
test("unsupported native schema fails with a diagnostic instead of unsafe fallback", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-schema-"));
  try {
    const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
    db.exec("CREATE TABLE threads (id TEXT)");
    db.close();
    const reader = new CodexReadOnly(home);
    await assert.rejects(reader.call("thread/list"), { status: 503 });
    assert.equal(reader.db, undefined);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});
test("instance validation preserves IDs and isolates provider type from instance", () => {
  assert.equal(validateInstances(defaultInstances()).length, 5);
  const instances = validateInstances([
    { id: "work", provider: "codex", name: "Work", home: "/tmp/work" },
    {
      id: "personal",
      provider: "codex",
      name: "Personal",
      home: "/tmp/personal",
    },
  ]);
  assert.notEqual(instances[0].home, instances[1].home);
  for (const id of ["../bad", "constructor", "__proto__"])
    assert.throws(() =>
      validateInstances([{ id, provider: "codex", name: "Invalid" }]),
    );
  assert.throws(() => validateInstances([...instances, instances[0]]));
  assert.throws(() =>
    validateInstances([
      {
        id: "d",
        provider: "dsh",
        name: "D",
        url: "http://user:secret@localhost",
      },
    ]),
  );
});
test("read-only capability wins over method availability and PID reuse fails closed", () => {
  const c = capabilities({
    provider: "claudeDesktop",
    readOnly: true,
    send() {},
    create() {},
  });
  assert.equal(c.reply, false);
  assert.equal(c.create, false);
  assert.equal(c.nativeWithdraw, false);
  assert.equal(matchesProcessGeneration({ startedAt: 10000 }, 20000), false);
  assert.equal(matchesProcessGeneration({ startedAt: 10000 }, null), false);
  assert.equal(matchesProcessGeneration({ startedAt: 10000 }, 9000), true);
});
