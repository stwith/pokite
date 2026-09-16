import test from "node:test";
import assert from "node:assert/strict";
import { Dsh } from "../server/dsh.mjs";
import { Codex, Penguin, codexFold, textContent } from "../server/adapters.mjs";
import {
  Codex as CodexImplementation,
  codexFold as fold,
} from "../server/codex.mjs";
import { Penguin as PenguinImplementation } from "../server/penguin.mjs";

test("adapter registry keeps existing class and parser identities", () => {
  assert.equal(Codex, CodexImplementation);
  assert.equal(Penguin, PenguinImplementation);
  assert.equal(codexFold, fold);
  assert.equal(textContent([{ type: "text", text: "hello" }]), "hello");
});

test("DeepSeek project labels fall back to directory names", async () => {
  const adapter = new Dsh();
  adapter.connect = () => {};
  adapter.call = async () => ({
    items: [
      { workspaceId: "a", path: "/tmp/example", sessionIds: [] },
      { workspaceId: "b", path: "/tmp/other", title: "Named", sessionIds: [] },
    ],
  });
  assert.deepEqual(
    (await adapter.projects()).map((p) => p.name),
    ["example", "Named"],
  );
});
