import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true, ...(engine === chromium ? { channel: "chrome" } : {}) });
  try {
    for (const empty of [true, false]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const requests = [], errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("agent", "codex2"));
      await page.route("**/api/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        requests.push(pathname);
        let data;
        if (pathname === "/api/agents") data = empty ? [] : [{ id: "codex", name: "Codex" }];
        else if (pathname.endsWith("/projects")) data = [{ id: "p", name: "Existing project", path: "/tmp" }];
        else if (pathname.endsWith("/sessions")) data = { items: [{ id: "s", title: "Existing session", status: "idle" }] };
        else data = { options: [], canSwitch: false };
        await route.fulfill({ json: data });
      });
      await page.goto("http://127.0.0.1:3230/#token=first-run-fixture");
      if (empty) { await page.getByText("未发现可接入的本机会话", { exact: true }).waitFor(); assert.deepEqual(requests, ["/api/agents"]); }
      else { await page.locator(".session").first().waitFor(); assert.ok(requests.includes("/api/codex/projects")); assert.ok(requests.every(url => !url.includes("codex2"))); }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.close(); console.log(engine.name(), empty ? "empty discovery" : "single detected profile", "passed");
    }
  } finally { await browser.close(); }
}
