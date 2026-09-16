import test from "node:test";
import assert from "node:assert/strict";
import {
  macHttpsProxy,
  verifyDesktopNetwork,
} from "../scripts/lib/desktop-network.mjs";

test("Desktop proxy discovery follows enabled macOS HTTPS settings", () => {
  assert.equal(
    macHttpsProxy(
      "<dictionary> {\n HTTPSEnable : 1\n HTTPSProxy : 127.0.0.1\n HTTPSPort : 7890\n}",
    ),
    "http://127.0.0.1:7890",
  );
  assert.equal(
    macHttpsProxy("HTTPSEnable : 0\nHTTPSProxy : localhost\nHTTPSPort : 1234"),
    null,
  );
  assert.equal(
    macHttpsProxy("HTTPSEnable : 1\nHTTPSProxy : ::1\nHTTPSPort : 1234"),
    "http://[::1]:1234",
  );
  assert.throws(
    () =>
      macHttpsProxy("HTTPSEnable : 1\nHTTPSProxy : user@bad\nHTTPSPort : 1234"),
    /Unsupported/,
  );
  assert.throws(
    () =>
      macHttpsProxy(
        "HTTPSEnable : 1\nHTTPSProxy : localhost\nHTTPSPort : 99999",
      ),
    /Unsupported/,
  );
});
test("Network preflight distinguishes route rejection before keychain access", async () => {
  let cancelled = 0;
  const response = (status) => ({
    status,
    body: { cancel: async () => cancelled++ },
  });
  assert.deepEqual(
    await verifyDesktopNetwork(async (url, options) => {
      assert.equal(options.headers, undefined);
      assert.equal(options.redirect, "error");
      return response(401);
    }),
    { networkReady: true },
  );
  await assert.rejects(
    verifyDesktopNetwork(async () => response(403)),
    /network preflight returned HTTP 403/,
  );
  assert.equal(cancelled, 2);
});
