import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
const app = express();
app.use(express.json());
const project = {
  id: "cowork-fixture",
  name: "Cowork · Demo",
  path: "",
  canCreate: false,
  virtual: true,
};
const session = {
  id: "remote:fixture:org:cse_demo",
  projectId: project.id,
  title: "Cowork verification",
  status: "idle",
  revision: "fixture",
  updatedAt: Date.now(),
  readOnly: false,
  canReply: true,
};
app.get("/api/agents", (_, res) =>
  res.json([
    {
      id: "claudeDesktop",
      name: "Claude Desktop · Cowork",
      capabilities: { read: true, reply: true, create: false },
    },
  ]),
);
app.get("/api/claudeDesktop/projects", (_, res) => res.json([project]));
app.get("/api/claudeDesktop/sessions", (req, res) =>
  res.json(
    req.query.limit ? { items: [session], nextCursor: null } : [session],
  ),
);
app.get("/api/claudeDesktop/sessions/:id", (_, res) =>
  res.json({
    ...session,
    messages: [
      {
        id: "fixture-u",
        role: "user",
        text: "Continue this existing Cowork task.",
      },
      {
        id: "fixture-a",
        role: "assistant",
        text: "This is the original Cowork session.",
      },
    ],
  }),
);
app.get("/api/claudeDesktop/models", (_, res) =>
  res.json({ options: [], current: null, canSwitch: false }),
);
app.get("/api/claudeDesktop/queue", (_, res) => res.json([]));
app.post("/api/claudeDesktop/sessions/:id/read", (_, res) =>
  res.json({ ok: true }),
);
app.get("/api/claudeDesktop/events", (_, res) => {
  res.type("text/event-stream").write('data: {"type":"ready"}\n\n');
});
app.use(express.static("dist"));
const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
await fs.mkdir("artifacts/cowork", { recursive: true });
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({
        locale: "zh-CN",
        viewport: { width: 390, height: 844 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${server.address().port}/#token=FIXTURE234`,
      );
      await page.locator("[data-session-id]").first().click();
      await page.getByText("This is the original Cowork session.").waitFor();
      const composer = page.getByRole("textbox", { name: "消息", exact: true });
      assert.equal(await composer.isDisabled(), false);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/cowork/${name}-mobile.png` });
      console.log(
        name +
          ": existing Cowork project/history/composer UI passed with synthetic data",
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
