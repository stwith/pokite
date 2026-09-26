import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Operations } from "../server/operations.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
import { renderDesktopLauncher } from "../server/sharing-setup.mjs";
import { listenAddresses } from "../server/listen-addresses.mjs";
import express from "express";
import http from "node:http";
import { installHttpProtection } from "../server/http-middleware.mjs";

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), "pokite-audit-"));

test("queue rejects same request ID for another instance, session, text or model", () => {
  const dir = fixture();
  try {
    const q = new MessageQueue(path.join(dir, "q.json"), {});
    q.add("a", "one", "hello", "request", { id: "m" });
    for (const input of [
      ["b", "one", "hello", { id: "m" }],
      ["a", "two", "hello", { id: "m" }],
      ["a", "one", "different", { id: "m" }],
      ["a", "one", "hello", { id: "other" }],
    ])
      assert.throws(
        () => q.add(input[0], input[1], input[2], "request", input[3]),
        { status: 409 },
      );
    assert.equal(q.items.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("retention removes sensitive results but old requests never execute twice", async () => {
  const dir = fixture();
  try {
    const op = new Operations(path.join(dir, "op.json"));
    await op.run("old-request-id", { text: "hello" }, async () => ({
      text: "private response",
    }));
    op.records["old-request-id"].finishedAt = 1;
    op.save();
    assert.ok(!fs.readFileSync(op.file, "utf8").includes("private response"));
    await assert.rejects(
      new Operations(op.file).run("old-request-id", { text: "hello" }, () =>
        assert.fail("replayed"),
      ),
      { status: 409 },
    );
    const q = new MessageQueue(path.join(dir, "q.json"), {});
    q.add("a", "s", "sensitive text", "queued-id");
    q.items[0].state = "sent";
    q.items[0].finishedAt = 1;
    q.save();
    assert.ok(!fs.readFileSync(q.file, "utf8").includes("sensitive text"));
    const next = new MessageQueue(q.file, {});
    assert.deepEqual(next.add("a", "s", "sensitive text", "queued-id"), {
      accepted: true,
      queued: false,
    });
    assert.throws(() => next.add("b", "s", "sensitive text", "queued-id"), {
      status: 409,
    });
    assert.equal(next.items.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("launcher falls back to native binary when runtime or repository disappears", () => {
  const dir = fixture();
  try {
    const fallback = path.join(dir, "original backend"),
      launcher = path.join(dir, "launcher");
    fs.writeFileSync(fallback, '#!/bin/sh\nprintf "native:%s" "$1"\n', {
      mode: 0o700,
    });
    for (const node of [process.execPath, path.join(dir, "missing node")]) {
      fs.writeFileSync(
        launcher,
        renderDesktopLauncher(
          node,
          path.join(dir, "missing repo/proxy.mjs"),
          path.join(dir, "config.json"),
          fallback,
        ),
        { mode: 0o700 },
      );
      assert.equal(
        execFileSync(launcher, ["literal $(bad)"], { encoding: "utf8" }),
        "native:literal $(bad)",
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("default listeners exclude LAN", async () => {
  const interfaces = {
    en0: [{ family: "IPv4", address: "192.168.1.6" }],
    utun: [{ family: "IPv4", address: "100.100.1.2" }],
  };
  assert.deepEqual(listenAddresses(false, interfaces, ["100.100.1.2"]), [
    "127.0.0.1",
    "100.100.1.2",
  ]);
  assert.deepEqual(listenAddresses(true, interfaces), ["0.0.0.0"]);
  assert.deepEqual(listenAddresses(false, interfaces), ["127.0.0.1"]);
});
