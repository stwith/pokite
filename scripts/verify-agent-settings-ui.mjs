import express from "express";
import http from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
const app = express();
app.use(express.json());
let rows;
const reset = () => {
  rows = [
    {
      id: "codex",
      name: "Codex",
      enabled: true,
      connected: true,
      canEnable: true,
    },
    {
      id: "penguin",
      name: "PenguinHarness",
      enabled: true,
      connected: false,
      canEnable: true,
    },
  ];
};
reset();
app.get("/api/agents", (_, res) =>
  res.json(
    rows
      .filter((r) => r.enabled)
      .map((r) => ({ ...r, capabilities: { read: true, reply: true } })),
  ),
);
app.get("/api/setup/discovery", (_, res) => res.json({ candidates: rows }));
app.post("/api/setup/toggle", (req, res) => {
  rows.find((r) => r.id === req.body.instanceId).enabled = req.body.enabled;
  res.json({ ok: true });
});
app.get("/api/:agent/projects", (_, res) => res.json([]));
app.get("/api/:agent/queue", (_, res) => res.json([]));
app.get("/api/:agent/events", (_, res) =>
  res.type("text/event-stream").write('data: {"type":"ready"}\n\n'),
);
app.use(express.static("dist"));
const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    reset();
    const browser = await engine.launch();
    try {
      // A LAN hostname proves the settings entry is not restricted to localhost UI.
      const page = await browser.newPage({
        locale: "zh-CN",
        viewport: { width: 390, height: 844 },
      });
      await page.route("http://pokite-mobile.test/**", async (route) => {
        if (route.request().url().endsWith("/events")) {
          await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: 'data: {"type":"ready"}\n\n',
          });
          return;
        }
        const response = await route.fetch({
          url: route
            .request()
            .url()
            .replace(
              "http://pokite-mobile.test",
              `http://127.0.0.1:${server.address().port}`,
            ),
        });
        await route.fulfill({ response });
      });
      await page.goto("http://pokite-mobile.test/#token=FIXTURE234");
      await page.getByRole("combobox", { name: "Agent", exact: true }).click();
      await page
        .getByRole("option", { name: "PenguinHarness", exact: true })
        .getByText("未连接", { exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page
        .getByRole("button", { name: "Agent 接入", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "已连接", exact: true })
        .waitFor();
      await page
        .getByRole("heading", { name: "未连接", exact: true })
        .waitFor();
      await page
        .getByRole("switch", { name: "PenguinHarness", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[role="switch"][aria-label="PenguinHarness"]')
            ?.getAttribute("aria-checked") === "false",
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByRole("combobox", { name: "Agent", exact: true }).click();
      assert.equal(
        await page.getByRole("option", { name: /PenguinHarness/ }).count(),
        0,
      );
      console.log(
        `${name}: mobile Agent groups, disconnected label and visibility switch passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
