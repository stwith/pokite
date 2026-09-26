import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
const app = express();
app.use(express.json());
let enabled = true,
  notified = false;
const calls = [];
app.get("/api/agents", (_, res) => res.json([]));
app.get("/api/setup/discovery", (_, res) =>
  res.json({
    candidates: [
      { id: "codex", name: "Codex", enabled: true, canEnable: true },
      { id: "codex2", name: "Codex 2", enabled, canEnable: true },
      { id: "dsh", name: "DeepSeek Harness", enabled: true, canEnable: true },
      {
        id: "penguin",
        name: "PenguinHarness",
        enabled: true,
        canEnable: true,
        notice: "请先启动电脑上的 Agent",
      },
      { id: "claude", name: "Claude Code", enabled: true, canEnable: true },
      { id: "hermes", name: "Hermes Desktop", enabled: true, canEnable: true },
    ],
  }),
);
app.post("/api/setup/toggle", (req, res) => {
  calls.push(req.body);
  enabled = req.body.enabled;
  res.json({ ok: true });
});
app.post("/api/notifications/status", (_, res) =>
  res.json({ enabled: notified }),
);
app.get("/api/notifications/config", (_, res) =>
  res.json({ publicKey: Buffer.alloc(65).toString("base64url") }),
);
app.post("/api/notifications/subscribe", (_, res) => {
  notified = true;
  res.json({ enabled: true });
});
app.post("/api/notifications/remove", (_, res) => {
  notified = false;
  res.json({ ok: true });
});
app.use(express.static("dist"));
const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
await fs.mkdir("artifacts/settings-ui", { recursive: true });
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const [mode, locale, width, height] of [
        ["desktop", "zh-CN", 1280, 850],
        ["mobile", "zh-CN", 390, 844],
        ["english", "en-US", 1280, 850],
      ]) {
        enabled = true;
        const page = await browser.newPage({
          locale,
          viewport: { width, height },
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(base + "/#token=FIXTURE234");
        await page.locator(".sidebar footer").waitFor();
        assert.equal(await page.locator(".sidebar footer button").count(), 2);
        await page
          .getByRole("button", {
            name: mode === "english" ? "Settings" : "设置",
            exact: true,
          })
          .click();
        assert.equal(
          await page
            .getByRole("switch", {
              name: mode === "english" ? "Task notifications" : "任务通知",
              exact: true,
            })
            .isDisabled(),
          true,
        );
        await page.screenshot({
          path: `artifacts/settings-ui/${name}-${mode}-settings.png`,
        });
        await page
          .getByRole("button", {
            name: mode === "english" ? "Agent connections" : "Agent 接入",
            exact: true,
          })
          .click();
        await page.locator(".setup-results li").first().waitFor();
        assert.equal(
          await page.locator('.setup-results [role="switch"]').count(),
          6,
        );
        assert.equal(await page.locator(".setup-status").count(), 1);
        assert.equal(
          await page
            .locator('.setup-results [role="switch"][aria-checked="true"]')
            .count(),
          6,
        );
        const dialog = page.locator('[role="dialog"]').last();
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        assert.equal(
          await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
          false,
        );
        await page.screenshot({
          path: `artifacts/settings-ui/${name}-${mode}.png`,
        });
        await page
          .getByRole("switch", { name: "Codex 2", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            document
              .querySelector('[role="switch"][aria-label="Codex 2"]')
              .getAttribute("aria-checked") === "false",
        );
        assert.deepEqual(calls.at(-1), {
          instanceId: "codex2",
          enabled: false,
        });
        assert.deepEqual(errors, []);
        await page.close();
        console.log(
          name +
            " " +
            mode +
            ": six switches, only actionable notice, direct notification switch and no overflow",
        );
      }
      const firstRun = await browser.newPage();
      await firstRun.goto(base + "/?setup=1#token=FIXTURE234");
      await firstRun.locator(".setup-results").waitFor();
      await firstRun.close();
      const secure = await browser.newPage({ locale: "en-US" });
      await secure.route("https://pokite.test/**", async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({
          url: base + url.pathname + url.search,
        });
        await route.fulfill({ response });
      });
      await secure.addInitScript(() => {
        const sub = {
          endpoint: "https://fcm.googleapis.com/fixture",
          unsubscribe: async () => true,
          toJSON: () => ({
            endpoint: "https://fcm.googleapis.com/fixture",
            keys: {},
          }),
        };
        const registration = {
          pushManager: {
            getSubscription: async () => sub,
            subscribe: async () => sub,
          },
        };
        Object.defineProperty(navigator, "serviceWorker", {
          value: {
            register: async () => registration,
            ready: Promise.resolve(registration),
            addEventListener() {},
            removeEventListener() {},
            getRegistration: async () => undefined,
          },
          configurable: true,
        });
        window.PushManager = function () {};
        window.Notification = {
          requestPermission: async () => {
            window.permissionCalls = (window.permissionCalls || 0) + 1;
            return "granted";
          },
        };
      });
      await secure.goto("https://pokite.test/#token=FIXTURE234");
      await secure
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      const notification = secure.getByRole("switch", {
        name: "Task notifications",
        exact: true,
      });
      await notification.click();
      await secure.waitForFunction(
        () =>
          document
            .querySelector("#task-notifications")
            .getAttribute("aria-checked") === "true",
      );
      assert.equal(notified, true);
      await notification.click();
      await secure.waitForFunction(
        () =>
          document
            .querySelector("#task-notifications")
            .getAttribute("aria-checked") === "false",
      );
      assert.equal(notified, false);
      assert.equal(await secure.evaluate(() => window.permissionCalls), 1);
      await secure.close();
      console.log(
        name + ": HTTPS notification on/off and first-run entry passed",
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
