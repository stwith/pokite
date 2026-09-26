import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { DeviceAuth } from "../server/device-auth.mjs";
import { createApp } from "../server/app.mjs";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-browser-auth-"));
const devices = new DeviceAuth(
  path.join(dir, "devices.json"),
  "fixture-master-only",
);
let server;
const app = createApp({
  adapters: {},
  agentNames: {},
  token: "fixture-master-only",
  devices,
  messages: {},
  operations: {},
  reads: {},
  saveReads() {},
  dist: path.resolve("dist"),
  getPort: () => server.address().port,
});
server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const first = devices.pairingToken();
      await page.goto(base + "#token=" + first);
      await page.waitForFunction(
        () => localStorage.getItem("access-token")?.length === 43,
      );
      const credential = await page.evaluate(() =>
        localStorage.getItem("access-token"),
      );
      assert.ok(devices.verify(credential));
      assert.equal(new URL(page.url()).hash, "");
      const count = Object.keys(devices.devices).length;
      await page.goto(base + "#token=" + devices.pairingToken());
      await page.waitForFunction(() => document.querySelector(".sidebar"));
      assert.equal(
        await page.evaluate(() => localStorage.getItem("access-token")),
        credential,
      );
      assert.equal(Object.keys(devices.devices).length, count);
      devices.revoke(devices.verify(credential).id);
      await page.goto(base + "#token=" + devices.pairingToken());
      await page.waitForFunction(
        (old) => localStorage.getItem("access-token") !== old,
        credential,
      );
      const replacement = await page.evaluate(() =>
        localStorage.getItem("access-token"),
      );
      assert.ok(devices.verify(replacement));
      assert.equal(Object.keys(devices.devices).length, count);
      assert.deepEqual(errors, []);
      console.log(
        name +
          ": initial pairing, repeated open and re-pair after revocation passed",
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  app.locals.events.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
}
