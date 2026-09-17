// Public screenshots use synthetic API responses, never local session data.
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";

const root = path.resolve("dist");
const output = path.resolve("assets/readme");
await fs.mkdir(output, { recursive: true });
const session = {
  id: "demo-session", projectId: "demo-project", title: "Polish the checkout flow",
  status: "completed", model: "", revision: "demo-1", pending: [], queue: [],
  messages: [
    { id: "u1", role: "user", text: "检查结账页面的移动端体验，修复布局问题。", time: "2026-09-17T02:20:00Z" },
    { id: "a1", role: "assistant", text: "### 移动端布局已修复\n\n- 修复窄屏下按钮被遮挡的问题\n- 保留表单内容，切换页面不丢失\n- 补充空购物车和支付失败提示\n\n**检查通过**：手机与平板尺寸下均无横向溢出。", time: "2026-09-17T02:21:00Z" },
    { id: "u2", role: "user", text: "我在手机上看到了。再把按钮文案改成「确认订单」。", time: "2026-09-17T02:22:00Z" },
    { id: "a2", role: "assistant", text: "已在这个会话中继续修改，按钮文案已更新为 **确认订单**。\n\n回到电脑后，可以在原会话里接着检查。", time: "2026-09-17T02:23:00Z" },
  ],
};
const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".html": "text/html" };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); res.end(await fs.readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: "Asia/Shanghai" });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname;
    if (endpoint.endsWith("/events")) return route.abort();
    if (route.request().method() !== "GET") return route.fulfill({ json: { ok: true } });
    const json = endpoint === "/api/agents" ? [{ id: "codex", name: "Codex Desktop" }]
      : endpoint.endsWith("/projects") ? [{ id: "demo-project", name: "Shop Demo", path: "/demo/shop" }]
      : endpoint.endsWith("/models") ? { options: [], canSwitch: false }
      : endpoint.endsWith("/sessions") ? { items: [session], nextCursor: null }
      : session;
    await route.fulfill({ json });
  });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/#token=public-demo-not-a-real-access-token`);
  await page.locator(".session").first().click();
  await page.locator(".markdown-body h3").waitFor();
  await page.locator(".conversation").evaluate(e => { e.scrollTop = 0; });
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const body = await page.locator("body").innerText();
  for (const secret of ["/Users/", "100.108.", "192.168.", "@gmail.com"]) assert.ok(!body.includes(secret));
  await page.screenshot({ path: path.join(output, "mobile-session.png") });
  console.log("Synthetic mobile screenshot saved; no live Agent API or credentials used.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
