import { chromium, webkit } from "playwright";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(
      "dist",
      req.url === "/" ? "index.html" : req.url.slice(1),
    );
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch(
      engine === chromium ? { channel: "chrome" } : {},
    );
    try {
      const page = await browser.newPage({
        viewport: {
          width: Number(process.env.POCKET_WIDTH) || 1440,
          height: 900,
        },
      });
      let historyReads = 0;
      const messages = (prefix) =>
        Array.from({ length: 30 }, (_, i) => ({
          id: prefix + i,
          role: "assistant",
          text: prefix + i + "\n\n" + "Reading position fixture. ".repeat(15),
        }));
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        let data = {};
        if (url.pathname === "/api/agents")
          data = [{ id: "codex2", name: "Fixture", capabilities: {} }];
        else if (url.pathname.endsWith("/projects"))
          data = [{ id: "p", name: "Fixture", path: "/tmp" }];
        else if (url.pathname.endsWith("/models"))
          data = { options: [], canSwitch: false };
        else if (url.pathname.endsWith("/events")) return route.abort();
        else if (url.pathname.endsWith("/sessions")) {
          const limit = Number(url.searchParams.get("limit"));
          data = {
            items: Array.from({ length: Math.min(80, limit) }, (_, i) => ({
              id: "s" + i,
              projectId: "p",
              title: "Session " + i,
              status: "idle",
            })),
            nextCursor: limit < 80 ? "40" : null,
          };
        } else if (url.pathname.endsWith("/history")) {
          historyReads++;
          if (process.env.POCKET_HISTORY_FAILURE && historyReads === 1)
            return route.fulfill({ status: 503, json: { error: "Temporary history outage" } });
          await new Promise((resolve) => setTimeout(resolve, 150));
          data = { messages: messages("Older"), hasMore: false };
        } else if (/\/sessions\/s\d+$/.test(url.pathname))
          data = {
            id: "s0",
            projectId: "p",
            title: "Session 0",
            status: "idle",
            messages: process.env.POCKET_SHORT_HISTORY
              ? [{ id: "recent", role: "assistant", text: "Recent" }]
              : messages("Recent"),
            hasMore: true,
            historyCursor: "cursor",
            pending: [],
          };
        await route.fulfill({ json: data });
      });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/#token=fixture`,
      );
      await page.waitForFunction(
        () => document.querySelectorAll(".session").length === 40,
      );
      await page.locator("nav").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.waitForFunction(
        () => document.querySelectorAll(".session").length === 80,
      );
      await page.locator(".session").first().click();
      await page.waitForFunction(
        () => document.querySelector(".conversation")?.scrollTop > 200,
      );
      assert.equal(
        await page.getByRole("button", { name: "回到最新消息" }).count(),
        0,
      );
      await page.locator(".conversation").evaluate((el) => {
        el.scrollTop = 60;
      });
      await page.waitForFunction(() =>
        document.querySelector(".conversation")?.textContent.includes("Older0"),
      );
      await page.waitForTimeout(200);
      assert.equal(historyReads, process.env.POCKET_HISTORY_FAILURE ? 2 : 1);
      assert.ok(
        process.env.POCKET_SHORT_HISTORY ||
          (await page
            .locator(".conversation")
            .evaluate((el) => el.scrollTop > 200)),
      );
      assert.equal(
        await page.getByRole("button", { name: /加载更多|加载更早/ }).count(),
        0,
      );
      await page.getByRole("button", { name: "回到最新消息" }).click();
      await page.waitForFunction(() => {
        const el = document.querySelector(".conversation");
        return el.scrollHeight - el.scrollTop - el.clientHeight < 2;
      });
      assert.equal(
        await page.getByRole("button", { name: "回到最新消息" }).count(),
        0,
      );
      console.log(
        engine.name(),
        process.env.POCKET_HISTORY_FAILURE
          ? "history failure recovered automatically; pagination passed"
          : "scroll-only list/history pagination and single request passed",
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
