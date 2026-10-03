import express from "express";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, webkit } from "playwright";
const app = express();
app.use(express.json());
let currentModel = "a",
  currentEffort = "low",
  created = false;
const submitted = [];
const project = {
  id: "p",
  name: "Cloud Project",
  path: "",
  virtual: true,
  canCreate: true,
};
const session = () => ({
  id: "remote:fixture:org:cse_created",
  projectId: "p",
  title: "Fixture session",
  status: "idle",
  revision: currentModel + currentEffort,
  model: currentModel,
  effort: currentEffort,
  canReply: true,
  messages: [
    { id: "u", role: "user", text: "hello" },
    { id: "a", role: "assistant", text: "Ready" },
  ],
});
app.get("/api/agents", (_, res) =>
  res.json([
    {
      id: "claudeDesktop",
      name: "Claude Desktop",
      capabilities: {
        read: true,
        reply: true,
        create: true,
        modelSelection: true,
      },
    },
  ]),
);
app.get("/api/claudeDesktop/projects", (_, res) => res.json([project]));
app.get("/api/claudeDesktop/sessions", (req, res) =>
  res.json(
    req.query.limit
      ? { items: created ? [session()] : [], nextCursor: null }
      : created
        ? [session()]
        : [],
  ),
);
app.get("/api/claudeDesktop/sessions/:id", (_, res) => res.json(session()));
app.get("/api/claudeDesktop/models", (_, res) =>
  res.json({
    current: currentModel,
    currentEffort,
    canSwitch: true,
    options: [
      {
        id: "a",
        label: "Model A",
        efforts: ["low", "high"],
        defaultEffort: "low",
      },
      {
        id: "b",
        label: "Model B",
        efforts: ["low", "high"],
        defaultEffort: "high",
      },
    ],
  }),
);
app.post("/api/claudeDesktop/sessions", (req, res) => {
  submitted.push({ kind: "create", ...req.body });
  created = true;
  currentModel = req.body.modelId;
  currentEffort = req.body.effort;
  res.json(session());
});
app.post("/api/claudeDesktop/sessions/:id/messages", (req, res) => {
  submitted.push({ kind: "reply", ...req.body });
  currentModel = req.body.modelId;
  currentEffort = req.body.effort;
  res.json({ accepted: true });
});
app.get("/api/claudeDesktop/queue", (_, res) => res.json([]));
app.post("/api/claudeDesktop/sessions/:id/read", (_, res) =>
  res.json({ ok: true }),
);
app.get("/api/claudeDesktop/events", (_, res) =>
  res.type("text/event-stream").write('data: {"type":"ready"}\n\n'),
);
app.use(express.static("dist"));
const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
await fs.mkdir("artifacts/controls", { recursive: true });
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      created = false;
      currentModel = "a";
      currentEffort = "low";
      submitted.length = 0;
      const page = await browser.newPage({
        locale: "zh-CN",
        viewport: { width: 390, height: 844 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${server.address().port}/#token=FIXTURE234`,
      );
      await page.getByRole("button", { name: "新建会话", exact: true }).click();
      const model = page.getByRole("combobox", { name: "模型", exact: true });
      await model.click();
      await page.getByRole("option", { name: "Model B", exact: true }).click();
      const effort = page.getByRole("combobox", {
        name: "推理强度",
        exact: true,
      });
      assert.match(await effort.innerText(), /high/);
      await effort.click();
      await page.getByRole("option", { name: "low", exact: true }).click();
      const input = page.getByRole("textbox", { name: "消息", exact: true });
      await input.fill("hello");
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page.getByText("Ready", { exact: true }).waitFor();
      assert.equal(submitted.filter((x) => x.kind === "create").length, 1);
      assert.equal(submitted[0].modelId, "b");
      assert.equal(submitted[0].effort, "low");
      await model.click();
      await page.getByRole("option", { name: "Model A", exact: true }).click();
      await effort.click();
      await page.getByRole("option", { name: "high", exact: true }).click();
      await input.fill("follow up");
      const replyResponse = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().endsWith("/messages"),
      );
      await page.getByRole("button", { name: "发送", exact: true }).click();
      assert.equal((await replyResponse).status(), 200);
      assert.equal(submitted.at(-1).kind, "reply");
      assert.equal(submitted.at(-1).modelId, "a");
      assert.equal(submitted.at(-1).effort, "high");
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/controls/${name}-mobile.png` });
      console.log(
        name + ": new session and model/effort selection request flow passed",
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
