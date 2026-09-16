import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserStorage } from "../src/lib/browser-storage.js";
import { restoreDraft } from "../src/lib/drafts.js";
test("storage failure preserves latest input in memory and retry persists it", () => {
  const disk = new Map();
  let blocked = true;
  const storage = createBrowserStorage(() => ({
    getItem: (k) => disk.get(k) ?? null,
    setItem(k, v) {
      if (blocked) throw Error("quota");
      disk.set(k, v);
    },
    removeItem: (k) => disk.delete(k),
  }));
  assert.equal(storage.setItem("draft", "latest input"), false);
  assert.equal(storage.getItem("draft"), "latest input");
  assert.equal(storage.hasUnsaved(), true);
  blocked = false;
  storage.retry();
  assert.equal(disk.get("draft"), "latest input");
  assert.equal(storage.hasUnsaved(), false);
});
test("unavailable storage getter never crashes the page and withdraw retries do not duplicate text", () => {
  const storage = createBrowserStorage(() => {
    throw Error("SecurityError");
  });
  assert.equal(storage.getItem("missing"), null);
  const receipt = { receiptId: "r", text: "restore me" };
  const first = restoreDraft(storage, "draft", receipt);
  assert.equal(first.saved, false);
  assert.equal(first.text, "restore me");
  assert.equal(restoreDraft(storage, "draft", receipt).text, "restore me");
  assert.equal(restoreDraft(storage, "draft", receipt).applied, false);
});
