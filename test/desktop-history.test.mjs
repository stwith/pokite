import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClaudeDesktop } from "../server/claude-desktop.mjs";
import { Codex } from "../server/adapters.mjs";
test("Codex log invalidates same-size edits and replacement, and obeys cache budget", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-log-cache-"));
  const event = (text) =>
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
      },
    }) + "\n";
  try {
    const file = path.join(root, "log.jsonl"),
      c = new Codex("test", root);
    await fs.writeFile(file, event("first"));
    assert.equal((await c.log({ path: file })).messages[0].text, "first");
    await fs.writeFile(file, event("other"));
    await fs.utimes(file, new Date(), new Date(Date.now() + 1000));
    assert.equal((await c.log({ path: file })).messages[0].text, "other");
    await fs.writeFile(file + ".tmp", event("replacement"));
    await fs.rename(file + ".tmp", file);
    assert.deepEqual(
      (await c.log({ path: file })).messages.map((m) => m.text),
      ["replacement"],
    );
    const tiny = new Codex("test", root, { logCacheBytes: 1 });
    assert.equal(
      (await tiny.log({ path: file })).messages[0].text,
      "replacement",
    );
    assert.equal(tiny.logs.size, 0);
    c.close();
    tiny.close();
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test("lifecycle before the tail window still determines the current state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-lifecycle-"));
  try {
    const file = path.join(root, "log.jsonl"),
      c = new Codex("test", root);
    const rows = [
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "running-turn" },
      },
      ...Array.from({ length: 2000 }, (_, i) => ({
        type: "response_item",
        ordinal: i,
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "x".repeat(1000) }],
        },
      })),
    ];
    await fs.writeFile(file, rows.map(JSON.stringify).join("\n") + "\n");
    const state = await c.log({ path: file });
    assert.equal(state.status, "running");
    assert.equal(state.turnId, "running-turn");
    assert.ok(state.messages.length <= 500);
    await fs.appendFile(
      file,
      JSON.stringify({
        type: "event_msg",
        payload: { type: "task_complete" },
      }) + "\n",
    );
    assert.equal((await c.log({ path: file })).status, "completed");
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test("desktop Cowork history comes from local audit and excludes tool payloads", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-desktop-"));
  try {
    const dir = path.join(root, "local-agent-mode-sessions/account/org");
    await fs.writeFile(
      path.join(root, "config.json"),
      JSON.stringify({ lastKnownAccountUuid: "account" }),
    );
    await fs.mkdir(path.join(dir, "local_test"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "local_test.json"),
      JSON.stringify({
        sessionId: "local_test",
        title: "Desktop task",
        createdAt: 1,
      }),
    );
    await fs.writeFile(
      path.join(dir, "local_test/audit.jsonl"),
      [
        {
          type: "user",
          uuid: "u",
          message: { content: [{ type: "text", text: "hello" }] },
        },
        {
          type: "assistant",
          uuid: "a",
          message: {
            content: [
              { type: "thinking", thinking: "private" },
              { type: "text", text: "world" },
            ],
          },
        },
        { type: "result", is_error: false },
      ]
        .map(JSON.stringify)
        .join("\n"),
    );
    const a = new ClaudeDesktop(root),
      p = await a.projects(),
      rows = await a.sessions(p[0].id),
      d = await a.detail(rows[0].id);
    assert.equal(rows[0].messages, undefined);
    assert.equal(d.readOnly, true);
    assert.equal(d.status, "completed");
    assert.deepEqual(
      d.messages.map((x) => x.text),
      ["hello", "world"],
    );
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test("large Codex logs load recent history at a UTF-8 line boundary and append without duplicates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-log-"));
  try {
    const file = path.join(root, "log.jsonl"),
      c = new Codex("test", root);
    const message = (ordinal, text) => ({
      type: "response_item",
      ordinal,
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
      },
    });
    await fs.writeFile(
      file,
      JSON.stringify(message(1, "字".repeat(500000))) +
        "\n" +
        JSON.stringify(message(2, "recent")) +
        "\n" +
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_complete" },
        }) +
        "\n",
    );
    const a = await c.log({ path: file });
    assert.equal(a.truncated, true);
    assert.deepEqual(
      a.messages.map((x) => x.text),
      ["recent"],
    );
    await fs.appendFile(file, JSON.stringify(message(3, "next")) + "\n");
    const b = await c.log({ path: file });
    assert.deepEqual(
      b.messages.map((x) => x.text),
      ["recent", "next"],
    );
    assert.equal(b.status, "completed");
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
