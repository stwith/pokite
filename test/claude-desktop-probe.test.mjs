import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import {
  decryptDesktopCache,
  sessionCredential,
  readSessionProbe,
  canonicalDesktopSessionId,
} from "../scripts/lib/claude-desktop-probe.mjs";

const credentialKey = (account, org, host = "https://api.anthropic.com") =>
  `acct:${account}|client:${org}:${host}:user:profile user:sessions:claude_code`;
test("Desktop known-session reads match canonical IDs without fabricating identity", async () => {
  assert.equal(canonicalDesktopSessionId("session_Ab12"), "cse_Ab12");
  assert.equal(canonicalDesktopSessionId("cse_Ab12"), "cse_Ab12");
  assert.equal(canonicalDesktopSessionId("session_../bad"), null);
  const fetched = [];
  const fetcher = async (url) => {
    fetched.push(url);
    return {
      ok: true,
      json: async () =>
        url.endsWith("/profile")
          ? { account: { uuid: "a" }, organization: { uuid: "org" } }
          : url.includes("?")
            ? { data: [] }
            : { session: { id: "cse_Ab12", title: "private" } },
    };
  };
  const result = await readSessionProbe("fixture", "a", "org", fetcher, [
    "session_Ab12",
    "session_Ab12",
    "session_../bad",
    "session_Other",
  ]);
  assert.equal(result.sessionCount, 0);
  assert.deepEqual(
    result.knownSessions.map((s) => s.found),
    [true, false],
  );
  assert.equal(fetched.length, 4);
  assert.ok(!JSON.stringify(result).includes("private"));
});
test("Desktop diagnostic decodes v10 but rejects unknown format or wrong key", () => {
  const key = pbkdf2Sync("fixture-password", "saltysalt", 1003, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  const encrypted = Buffer.concat([
    Buffer.from("v10"),
    cipher.update(JSON.stringify({ fixture: true })),
    cipher.final(),
  ]).toString("base64");
  assert.deepEqual(decryptDesktopCache(encrypted, "fixture-password"), {
    fixture: true,
  });
  assert.throws(
    () => decryptDesktopCache(encrypted, "wrong"),
    /could not be decoded/,
  );
  assert.throws(
    () =>
      decryptDesktopCache(
        Buffer.from("v20unknown").toString("base64"),
        "fixture-password",
      ),
    /Unsupported/,
  );
});
test("Desktop diagnostic never selects credentials from another account, org or host", () => {
  const valid = { token: "fixture-token", expiresAt: 2000 };
  const key = credentialKey("a", "org");
  assert.equal(
    sessionCredential({ [key]: valid }, "a", "org", 1000),
    valid.token,
  );
  for (const cache of [
    { [credentialKey("other", "org")]: valid },
    { [credentialKey("a", "other")]: valid },
    { [credentialKey("a", "org", "https://example.com")]: valid },
    { [key]: { ...valid, expiresAt: 500 } },
    { [key]: valid, [key.replace("client:", "second:")]: valid },
  ])
    assert.throws(
      () => sessionCredential(cache, "a", "org", 1000),
      /No unique/,
    );
});
test("Desktop diagnostic checks profile identity before read-only session requests", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () =>
        url.endsWith("/profile")
          ? { account: { uuid: "a" }, organization: { uuid: "org" } }
          : { sessions: [{ id: "s", title: "private fixture title" }] },
    };
  };
  const result = await readSessionProbe("fixture-token", "a", "org", fetcher);
  assert.equal(result.sessionCount, 1);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.ok(
    calls.every(
      (c) =>
        c.options.method === "GET" &&
        c.options.redirect === "error" &&
        c.url.startsWith("https://api.anthropic.com/"),
    ),
  );
  calls.length = 0;
  await assert.rejects(
    readSessionProbe("fixture-token", "other", "org", fetcher),
    /identity/,
  );
  assert.equal(calls.length, 1);
});

test("Desktop probe reports rejection stage without exposing server text", async () => {
  const fetcher = async () =>
    new Response(
      JSON.stringify({ error: "missing scope", private: "secret-fixture" }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  await assert.rejects(
    readSessionProbe("fixture", "a", "org", fetcher),
    (error) => {
      assert.match(error.message, /\/api\/oauth\/profile HTTP 403/);
      assert.match(error.message, /hints=scope/);
      assert.ok(!error.message.includes("secret-fixture"));
      return true;
    },
  );
});
