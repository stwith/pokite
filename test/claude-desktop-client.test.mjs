import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { ClaudeDesktopClient } from "../server/claude-desktop-client.mjs";

async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-client-"));
  const password = Buffer.from("fixture-key");
  const cipher = createCipheriv(
    "aes-128-cbc",
    pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1"),
    Buffer.alloc(16, 32),
  );
  const cache = {
    "acct:account|client:org:https://api.anthropic.com:user:profile user:sessions:claude_code":
      { token: "fixture-token", expiresAt: Date.now() + 100000 },
  };
  const encrypted = Buffer.concat([
    Buffer.from("v10"),
    cipher.update(JSON.stringify(cache)),
    cipher.final(),
  ]).toString("base64");
  await fs.mkdir(path.join(root, "local-agent-mode-sessions/account/org"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "config.json"),
    JSON.stringify({
      lastKnownAccountUuid: "account",
      "oauth:tokenCacheV2": encrypted,
    }),
  );
  try {
    await fn(root, password);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("Cowork client preflights before keychain, caches only in memory and validates identity", () =>
  fixture(async (root, password) => {
    let keyReads = 0,
      profileReads = 0,
      calls = 0,
      closed = 0;
    const c = new ClaudeDesktopClient(root, {
      readKey: async () => {
        keyReads++;
        return password;
      },
      network: async () => ({ close: async () => closed++ }),
      fetcher: async (url, options) => {
        if (!options.headers) {
          assert.equal(keyReads, 0);
          return new Response("", { status: 401 });
        }
        assert.equal(options.redirect, "error");
        if (url.endsWith("/profile")) {
          profileReads++;
          return Response.json({
            account: { uuid: "account" },
            organization: { uuid: "org" },
          });
        }
        calls++;
        return Response.json({ ok: true });
      },
    });
    assert.deepEqual(
      await c.request("/v1/code/sessions/cse_1", { scope: "account:org" }),
      { ok: true },
    );
    await c.request("/v1/code/sessions/cse_1");
    assert.equal(keyReads, 1);
    assert.equal(profileReads, 1);
    assert.equal(calls, 2);
    await assert.rejects(
      c.request("/v1/code/sessions/cse_1", { scope: "other:org" }),
      (error) =>
        /账号已切换/.test(error.message) && error.delivery === "not-sent",
    );
    assert.equal(calls, 2);
    await c.close();
    assert.equal(closed, 1);
    assert.ok(password.every((n) => n === 0));
  }));

test("Cowork network denial cannot request a credential", () =>
  fixture(async (root) => {
    let reads = 0;
    const c = new ClaudeDesktopClient(root, {
      readKey: async () => {
        reads++;
      },
      network: async () => ({ close: async () => {} }),
      fetcher: async () => new Response("denied", { status: 403 }),
    });
    await assert.rejects(c.request("/v1/code/sessions"), /网络预检/);
    assert.equal(reads, 0);
    await c.close();
  }));

test("Cowork ambiguous submission does not retry or expose upstream bodies", () =>
  fixture(async (root, password) => {
    let posts = 0;
    const c = new ClaudeDesktopClient(root, {
      readKey: async () => password,
      network: async () => ({ close: async () => {} }),
      fetcher: async (url, options) => {
        if (!options.headers) return new Response("", { status: 401 });
        if (url.endsWith("/profile"))
          return Response.json({
            account: { uuid: "account" },
            organization: { uuid: "org" },
          });
        posts++;
        return new Response("private upstream body", { status: 500 });
      },
    });
    await assert.rejects(
      c.request("/v1/code/sessions/cse_1/events", { method: "POST", body: {} }),
      (error) =>
        error.delivery === "unknown" && !error.message.includes("private"),
    );
    assert.equal(posts, 1);
    await c.close();
  }));
