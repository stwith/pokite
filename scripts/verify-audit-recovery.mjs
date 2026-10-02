import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium, webkit } from "playwright";
import { createApp } from "../server/app.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
import { Operations } from "../server/operations.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-recovery-ui-"));
await fs.mkdir("artifacts/audit-recovery", { recursive: true });
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const scenario of ["creation-retry", "creation-response-loss", "agent-fallback", "question-isolation"]) {
        let creates = 0, server, failedSave = false;
        const submissions = [], answers = [];
        const row = (id) => ({ id, projectId: "p", title: id, status: "idle", revision: "1", messages: [], canReply: true });
        const adapter = (id) => ({
          projects: async () => [{ id: "p", name: "Project " + id, path: dir }],
          models: async () => ({ options: [], canSwitch: false }),
          sessions: async () => [row("one"), row("two"), ...(creates ? [row("created")] : [])],
          detail: async (sid) => ({ ...row(sid), pending: scenario === "question-isolation" ? [{
            id: "approval-" + sid, kind: "question", questions: [{ id: "0", question: "Question " + sid }],
          }] : [] }),
          create: async () => { creates++; return { id: "created" }; },
          send: async () => { assert.fail("UI fixture must never dispatch"); },
          answer: async (sid, aid, body) => { answers.push({ sid, aid, body }); return { accepted: true }; },
        });
        const adapters = { codex2: adapter("codex2"), claude: adapter("claude") };
        const file = path.join(dir, name + "-" + scenario);
        const messages = new MessageQueue(file + "-queue.json", adapters);
        const save = messages.save.bind(messages);
        messages.save = () => {
          if (scenario === "creation-retry" && !failedSave) { failedSave = true; throw Error("fixture queue persistence outage"); }
          save();
        };
        const app = createApp({ adapters, agentNames: { codex2: "Codex2", claude: "Claude" },
          token: "test-code", messages, operations: new Operations(file + "-ops.json"),
          reads: {}, saveReads() {}, dist: path.resolve("dist"), getPort: () => server.address().port });
        server = http.createServer((req, res) => {
          if (req.method === "POST" && req.url === "/api/codex2/sessions") {
            let text = "";
            req.on("data", (chunk) => { text += chunk; });
            req.on("end", () => submissions.push(JSON.parse(text)));
          }
          app(req, res);
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.setDefaultTimeout(15000);
        try {
          await page.goto(base + "/#token=test-code");
          await page.locator(".sidebar").waitFor();
          await page.getByRole("combobox", { name: /项目|Project/, exact: true }).waitFor();
          if (scenario.startsWith("creation-")) {
            if (scenario === "creation-response-loss") {
              let lost = false;
              await page.route("**/api/codex2/sessions", async (route) => {
                if (route.request().method() !== "POST" || lost) return route.continue();
                lost = true;
                await route.fetch();
                await route.abort("failed");
              });
            }
            await page.locator("textarea").fill("initial message with durable identity");
            await page.getByRole("button", { name: /^(发送|Send)$/ }).click();
            await page.getByRole("alert").waitFor();
            assert.ok(await page.evaluate(() => localStorage.getItem("pending-send:codex2:p")));
            await page.reload();
            await page.waitForFunction(() => document.querySelector("textarea")?.value === "initial message with durable identity");
            await page.getByRole("button", { name: /^(发送|Send)$/ }).click();
            await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
            assert.equal(creates, 1);
            assert.equal(submissions.length, 2);
            assert.deepEqual(submissions[0], submissions[1]);
            assert.equal(messages.list("codex2", "created").length, 1);
            assert.equal(await page.evaluate(() => localStorage.getItem("pending-send:codex2:p")), null);
          } else if (scenario === "agent-fallback") {
            await page.locator("textarea").fill("only for codex2");
            adapters.codex2.pokiteEnabled = false;
            await page.evaluate(() => window.dispatchEvent(new Event("pokite:agents-changed")));
            await page.waitForFunction(() => document.querySelector(".main")?.textContent.includes("Project claude"));
            assert.equal(await page.locator("textarea").inputValue(), "");
            assert.match(await page.evaluate(() => localStorage.getItem("draft:codex2:p:record")), /only for codex2/);
          } else {
            await page.locator('[data-session-id="one"]').click();
            await page.locator(".approval input").fill("first answer");
            await page.locator('[data-session-id="two"]').click();
            await page.getByText("Question two", { exact: true }).waitFor();
            assert.equal(await page.locator(".approval input").inputValue(), "");
            await page.locator(".approval input").fill("second answer");
            await page.getByRole("button", { name: /^(提交|Submit)$/ }).click();
            await page.waitForFunction(() => !document.querySelector(".approval button")?.disabled);
            assert.deepEqual(answers[0].body.answers, { "0": "second answer" });
            await page.locator('[data-session-id="one"]').click();
            await page.getByText("Question one", { exact: true }).waitFor();
            assert.equal(await page.locator(".approval input").inputValue(), "first answer");
            adapters.codex2.detail = async (sid) => ({ ...row(sid), pending: [{
              id: "next-approval", kind: "question", questions: [{ id: "0", question: "Next question" }],
            }] });
            await page.evaluate(() => window.dispatchEvent(new CustomEvent("pocket-session-change", { detail: { agent: "codex2" } })));
            await page.getByText("Next question", { exact: true }).waitFor();
            assert.equal(await page.locator(".approval input").inputValue(), "");
          }
          await page.screenshot({ path: `artifacts/audit-recovery/${name}-${scenario}.png`, fullPage: true });
          console.log(`${name}: ${scenario} passed`);
        } finally {
          await page.close();
          await messages.stop();
          app.locals.events.close();
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      }
    } finally { await browser.close(); }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
