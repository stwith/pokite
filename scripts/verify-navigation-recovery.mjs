import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const token = (await fs.readFile(".local/access-token", "utf8")).trim();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let failProjects = true,
    failSessions = true;
  await page.route("**/api/codex2/projects", async (route) => {
    if (failProjects) {
      failProjects = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.route("**/api/codex2/sessions?*", async (route) => {
    if (failSessions) {
      failSessions = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto("http://127.0.0.1:3230/#token=" + token);
  await page.locator(".session").first().waitFor({ timeout: 60000 });
  await page.locator(".sync-banner").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator(".error-banner").count(),
    0,
    "successful polling clears transient errors",
  );
  assert.ok(
    (await page.locator(".sidebar footer").innerText()).includes("已连接"),
  );
  const close = page.getByRole("button", { name: "关闭导航", exact: true });
  await close.hover();
  await close.focus();
  await page.waitForTimeout(500);
  assert.equal(
    await page.getByRole("tooltip").count(),
    0,
    "navigation close has no tooltip",
  );
  await page
    .locator(".session-title>span")
    .first()
    .evaluate((e) => (e.textContent = "long-session-name".repeat(400)));
  const bounds = await page.locator(".sidebar nav").evaluate((e) => {
    e.scrollLeft = 500;
    return {
      left: e.scrollLeft,
      width: e.clientWidth,
      scrollWidth: e.scrollWidth,
      x: getComputedStyle(e).overflowX,
      y: getComputedStyle(e).overflowY,
      touch: getComputedStyle(e).touchAction,
    };
  });
  assert.equal(bounds.left, 0);
  assert.equal(bounds.scrollWidth, bounds.width);
  assert.equal(bounds.x, "hidden");
  assert.equal(bounds.y, "auto");
  assert.equal(bounds.touch, "pan-y");
  await page.screenshot({ path: "artifacts/navigation-recovery.png" });
  console.log(
    "Recovered after project and session fetch failures; no stale error or navigation tooltip; horizontal scrolling blocked",
    bounds,
  );
} finally {
  await browser.close();
}
