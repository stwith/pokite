import { chromium, webkit } from "playwright";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
import { Operations } from "../server/operations.mjs";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-sync-"));
let revision = 1,
  detailReads = 0,
  server;
const adapter = {
  projects: async () => [{ id: "p", name: "Fixture", path: directory }],
  sessions: async () => [
    {
      id: "s",
      projectId: "p",
      title: "Sync fixture",
      status: "running",
      revision: String(revision),
    },
  ],
  models: async () => ({ options: [], canSwitch: false }),
  detail: async () => {
    detailReads++;
    return {
      id: "s",
      projectId: "p",
      title: "Sync fixture",
      status: "running",
      revision: String(revision),
      messages: [
        {
          id: "m",
          role: "assistant",
          text: `Revision ${revision}\n\n` + "Sample text. ".repeat(1000),
        },
      ],
      pending: [],
    };
  },
};
const adapters = { codex2: adapter },
  token = "fixture-only-token";
const app = createApp({
  adapters,
  agentNames: { codex2: "Codex 2" },
  token,
  messages: new MessageQueue(path.join(directory, "queue.json"), adapters),
  operations: new Operations(path.join(directory, "operations.json")),
  reads: {},
  saveReads() {},
  dist: path.resolve("dist"),
  getPort: () => server.address().port,
});
let eventResponse;
server = http.createServer((req, res) => {
  if (req.url === "/api/codex2/events") eventResponse = res;
  app(req, res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({
      headless: true,
      ...(engine === chromium ? { channel: "chrome" } : {}),
    });
    try {
      revision = 1;
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      if (process.env.POCKET_TRACE) {
        page.on("request", (r) => {
          if (r.url().includes("/api/"))
            console.log(Date.now(), "request", new URL(r.url()).pathname);
        });
        page.on("response", (r) => {
          if (r.url().includes("/api/"))
            console.log(Date.now(), "response", new URL(r.url()).pathname);
        });
        page.on("console", (m) => console.log(Date.now(), "console", m.text()));
      }
      await page.addInitScript(() => {
        localStorage.setItem("agent", "codex2");
        window.fixtureHidden = false;
        Object.defineProperty(document, "hidden", {
          get: () => window.fixtureHidden,
        });
      });
      await page.goto(base + "/#token=" + token);
      await page.locator(".session").first().click();
      await page
        .locator(".markdown-body")
        .filter({ hasText: "Revision 1" })
        .waitFor();
      assert.equal(app.locals.events.groups.size, 1);
      await page.evaluate(() => {
        window.fixtureRenderedAt = null;
        const observer = new MutationObserver(() => {
          if (
            document
              .querySelector(".markdown-body")
              ?.textContent.includes("Revision 2")
          ) {
            window.fixtureRenderedAt =
              performance.timeOrigin + performance.now();
            observer.disconnect();
          }
        });
        observer.observe(document.querySelector(".conversation"), {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
      const start = Date.now();
      revision = 2;
      app.locals.events.notify("codex2");
      if (process.env.POCKET_TRACE) console.log(start, "notify");
      await page.waitForFunction(() =>
        document
          .querySelector(".markdown-body")
          ?.textContent.includes("Revision 2"),
      );
      const renderedAt = await page.evaluate(() => window.fixtureRenderedAt);
      const updateMs = renderedAt - start;
      assert.ok(Number.isFinite(renderedAt) && updateMs >= 0);
      if (process.env.POCKET_SYNC_MAX_MS)
        assert.ok(
          updateMs < Number(process.env.POCKET_SYNC_MAX_MS),
          `Event update took ${updateMs}ms`,
        );
      await page.route("**/api/codex2/events", (route) => route.abort());
      eventResponse.end();
      revision = 3;
      await page.waitForFunction(
        () =>
          document
            .querySelector(".markdown-body")
            ?.textContent.includes("Revision 3"),
        null,
        { timeout: 10000 },
      );
      await page.unroute("**/api/codex2/events");
      await page.evaluate(() => {
        window.fixtureHidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(500);
      assert.equal(app.locals.events.groups.size, 0);
      const before = detailReads;
      await page.waitForTimeout(5500);
      const hiddenDetailReads = detailReads - before;
      assert.equal(hiddenDetailReads, 0);
      revision = 4;
      await page.evaluate(() => {
        window.fixtureHidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page
        .locator(".markdown-body")
        .filter({ hasText: "Revision 4" })
        .waitFor();
      const headers = { Authorization: "Bearer " + token };
      const first = await fetch(base + "/api/codex2/sessions/s", { headers });
      const tag = first.headers.get("etag"),
        firstBytes = (await first.text()).length;
      const next = await fetch(base + "/api/codex2/sessions/s", {
        headers: { ...headers, "If-None-Match": tag },
      });
      assert.equal(next.status, 304);
      const unchangedBytes = (await next.text()).length;
      assert.equal(unchangedBytes, 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/sync-${engine.name()}.png` });
      results.push({
        browser: engine.name(),
        updateMs,
        performanceTargetMs: 1000,
        withinPerformanceTarget: updateMs < 1000,
        streamOutageRecovered: true,
        hiddenDetailReads,
        firstBytes,
        unchangedBytes,
        foregroundRecovered: true,
      });
      console.log(
        engine.name(),
        "event update, hidden unsubscribe, resume and 304 passed",
        updateMs + "ms",
      );
    } finally {
      await browser.close();
    }
  }
  await fs.writeFile(
    "artifacts/sync-verification.json",
    JSON.stringify(
      { fixture: "1000 repeated sample sentences; 390x844", results },
      null,
      2,
    ),
  );
} finally {
  app.locals.events.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}
