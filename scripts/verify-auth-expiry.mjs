import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { createApp } from "../server/app.mjs";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-expiry-"));
let token = "original-code",
  upstream401 = false,
  requests = 0;
const adapter = {
  projects: async () => {
    if (upstream401)
      throw Object.assign(Error("Upstream login expired"), { status: 401 });
    return [{ id: "p", name: "Fixture", path: dir }];
  },
  models: async () => ({ options: [], canSwitch: false }),
  sessions: async () => [],
};
let server;
const app = createApp({
  adapters: { fixture: adapter },
  agentNames: { fixture: "Fixture" },
  getToken: () => token,
  resetAccess: () => (token = "replacement-code"),
  messages: { list: () => [] },
  operations: {},
  reads: {},
  saveReads() {},
  dist: path.resolve("dist"),
  getPort: () => server.address().port,
});
server = http.createServer((req, res) => {
  if (req.url.startsWith("/api")) requests++;
  app(req, res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      token = "original-code";
      upstream401 = false;
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "#token=" + token);
      await page.locator(".sidebar").waitFor();
      await page
        .getByRole("combobox", { name: /项目|Project/, exact: true })
        .waitFor();
      // Force a resource refresh with a provider-side 401; this must not log out.
      upstream401 = true;
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("pocket-session-change", {
            detail: { agent: "fixture" },
          }),
        ),
      );
      await page.waitForTimeout(300);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("access-token")),
        "original-code",
      );
      upstream401 = false;
      token = "replacement-code";
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.waitForFunction(
        () => localStorage.getItem("access-token") === null,
      );
      await page.waitForFunction(() => !document.querySelector(".sidebar"));
      await page.waitForTimeout(300);
      const count = requests;
      await page.evaluate(() => {
        window.dispatchEvent(new Event("online"));
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(
          new CustomEvent("pocket-session-change", {
            detail: { agent: "fixture" },
          }),
        );
      });
      await page.waitForTimeout(2500);
      assert.equal(requests, count, "logged-out page kept retrying");
      await page.goto(base + "#token=replacement-code");
      await page.locator(".sidebar").waitFor();
      assert.equal(
        await page.evaluate(() => localStorage.getItem("access-token")),
        "replacement-code",
      );
      assert.deepEqual(errors, []);
      console.log(
        name +
          ": expired token logs out, polling/SSE stop, replacement code reconnects",
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  app.locals.events.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
}
