import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { createApp } from "../server/app.mjs";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-browser-access-"));
let token = "fixture-shared-access-code",
  server;
const app = createApp({
  adapters: {},
  agentNames: {},
  getToken: () => token,
  resetAccess: () => (token = "replacement-shared-code"),
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
    token = "fixture-shared-access-code";
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "#token=" + token);
      await page.waitForFunction(
        (code) => localStorage.getItem("access-token") === code,
        token,
      );
      assert.equal(new URL(page.url()).hash, "");
      await page.goto(base + "#token=" + token);
      await page.waitForFunction(() => document.querySelector(".sidebar"));
      assert.equal(
        await page.evaluate(() => localStorage.getItem("access-token")),
        token,
      );
      // A separate browser origin uses exactly the same code.
      const other = await browser.newPage();
      await other.goto(
        base.replace("127.0.0.1", "localhost") + "#token=" + token,
      );
      await other.waitForFunction(
        (code) => localStorage.getItem("access-token") === code,
        token,
      );
      // Exercise the actual reset UI and its persisted new code.
      await page
        .getByRole("button", { name: /连接手机|Connect a phone/ })
        .click();
      await page
        .getByRole("button", { name: /重置访问码|Reset access code/ })
        .click();
      await page
        .getByRole("button", { name: /确认重置|Confirm reset/ })
        .click();
      await page.waitForFunction(
        () =>
          localStorage.getItem("access-token") === "replacement-shared-code",
      );
      await other.goto(
        base.replace("127.0.0.1", "localhost") + "#token=" + token,
      );
      await other.waitForFunction(
        (code) => localStorage.getItem("access-token") === code,
        token,
      );
      assert.deepEqual(errors, []);
      console.log(
        name +
          ": shared code across origins, repeat login, reset UI and reconnect passed",
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
