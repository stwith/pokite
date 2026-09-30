import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readJson,
  writeFileAtomic,
  writeFileAtomicAsync,
} from "../server/json-file.mjs";

test("atomic writes are owner-only, leave no temporaries and accept file URLs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-json-file-"));
  try {
    const file = path.join(dir, "nested/state.json");
    writeFileAtomic(file, JSON.stringify({ a: 1 }));
    assert.deepEqual(readJson(file, null), { a: 1 });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    await writeFileAtomicAsync(file, JSON.stringify({ a: 2 }));
    writeFileAtomic(pathToFileURL(file), JSON.stringify({ a: 3 }));
    assert.deepEqual(readJson(pathToFileURL(file), null), { a: 3 });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["state.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing files read as the fallback; corrupt files throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-json-file-"));
  try {
    const file = path.join(dir, "state.json");
    assert.deepEqual(readJson(file, { empty: true }), { empty: true });
    fs.writeFileSync(file, "{not json");
    assert.throws(() => readJson(file, {}), SyntaxError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
