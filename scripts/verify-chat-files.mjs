import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium, webkit } from "playwright";
import { createApp } from "../server/app.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
import { Operations } from "../server/operations.mjs";

function pdfFixture() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 29 >>\nstream\n0 0 1 rg 0 0 300 400 re f\nendstream",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 6 0 R >>",
    "<< /Length 29 >>\nstream\n0 1 0 rg 0 0 300 400 re f\nendstream",
  ];
  let data = "%PDF-1.7\n",
    offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 7\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(data);
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2sAAAAASUVORK5CYII=",
  "base64",
);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-files-ui-"));
await fs.mkdir("artifacts/chat-files", { recursive: true });
try {
  await fs.writeFile(
    path.join(dir, "desktop.txt"),
    "Desktop file preview\nSecond line",
  );
  await fs.writeFile(path.join(dir, "photo.png"), png);
  await fs.writeFile(path.join(dir, "pages.pdf"), pdfFixture());
  await fs.writeFile(
    path.join(dir, "notes.md"),
    "# Desktop Notes\n\n- one\n- two\n",
  );
  await fs.writeFile(
    path.join(dir, "unsafe.html"),
    "<script>window.previewExecuted = true</script>",
  );
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const viewport of [
        { width: 320, height: 720 },
        { width: 390, height: 844 },
        { width: 1280, height: 900 },
      ]) {
        let server;
        const row = (id) => ({
          id,
          projectId: "p",
          cwd: dir,
          title: id,
          status: "idle",
          revision: "1",
          canReply: true,
          messages: [
            {
              id: "m",
              role: "assistant",
              text: "[Desktop text](desktop.txt)\n![Desktop photo](photo.png)\n[Desktop PDF](pages.pdf)\n[Desktop Markdown](notes.md)\n[HTML source](unsafe.html)\n[Missing file](missing.txt)",
            },
          ],
          pending: [],
        });
        const adapters = {
          codex2: {
            projects: async () => [{ id: "p", name: "Project", path: dir }],
            models: async () => ({ options: [], canSwitch: false }),
            sessions: async () => [row("one"), row("two")],
            detail: async (id) => row(id),
            send: async () => {
              assert.fail("Fixture must not run agent work");
            },
          },
        };
        const prefix = path.join(dir, name + "-" + viewport.width);
        const messages = new MessageQueue(prefix + "-queue.json", adapters);
        const app = createApp({
          adapters,
          agentNames: { codex2: "Codex2" },
          token: "test-code",
          messages,
          operations: new Operations(prefix + "-ops.json"),
          reads: {},
          saveReads() {},
          dist: path.resolve("dist"),
          uploadDirectory: prefix + "-uploads",
          getPort: () => server.address().port,
        });
        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const page = await browser.newPage({ viewport });
        const failures = [];
        page.on("pageerror", (error) => failures.push(error.message));
        page.setDefaultTimeout(15000);
        try {
          await page.goto(base + "/#token=test-code");
          await page.locator('[data-session-id="one"]').click();
          const input = page.getByRole("textbox", { name: /^(消息|Message)$/ });
          const attach = page.getByRole("button", {
            name: /^(添加照片或文件|Add photos or files)$/,
          });
          const appearance = await attach.evaluate((button) => {
            const box = button.getBoundingClientRect();
            const input = button.parentElement
              .querySelector("textarea")
              .getBoundingClientRect();
            const icon = button.querySelector("svg").getBoundingClientRect();
            return {
              background: getComputedStyle(button).backgroundColor,
              width: box.width,
              iconWidth: icon.width,
              leftOfInput: box.right <= input.left,
              sameRow: box.top === input.top,
              inToolbar: Boolean(button.closest(".composer-actions")),
            };
          });
          assert.deepEqual(appearance, {
            background: "rgba(0, 0, 0, 0)",
            width: 28,
            iconWidth: 16,
            leftOfInput: true,
            sameRow: true,
            inToolbar: false,
          });
          await attach.hover();
          assert.equal(
            await attach.evaluate(
              (button) => getComputedStyle(button).backgroundColor,
            ),
            "rgba(0, 0, 0, 0)",
          );
          await page.screenshot({
            path: `artifacts/chat-files/${name}-${viewport.width}-composer.png`,
          });
          await input.fill("first line");
          await input.press("Enter");
          await input.press("a");
          assert.equal(await input.inputValue(), "first line\na");
          assert.equal(messages.list("codex2", "one").length, 0);
          await input.dispatchEvent("keydown", {
            key: "Enter",
            isComposing: true,
            keyCode: 229,
          });
          assert.equal(messages.list("codex2", "one").length, 0);
          await page.locator('input[type="file"]').setInputFiles([
            { name: "phone photo.png", mimeType: "image/png", buffer: png },
            {
              name: "phone notes.txt",
              mimeType: "text/plain",
              buffer: Buffer.from("Phone file contents"),
            },
          ]);
          await page.waitForFunction(() =>
            document
              .querySelector("textarea")
              .value.includes("phone notes.txt"),
          );
          const draft = await input.inputValue();
          assert.match(draft, /phone photo.png/);
          await page.reload();
          await page.locator('[data-session-id="one"]').click();
          await page.waitForFunction(() =>
            document
              .querySelector("textarea")
              ?.value.includes("phone notes.txt"),
          );
          await page.getByRole("button", { name: /^(发送|Send)$/ }).click();
          await page.waitForFunction(
            () => document.querySelector("textarea").value === "",
          );
          assert.equal(messages.list("codex2", "one").length, 1);
          assert.equal(messages.list("codex2", "one")[0].text, draft.trim());
          await page
            .getByRole("button", { name: "phone notes.txt", exact: true })
            .click();
          await page
            .getByText("Phone file contents", { exact: true })
            .waitFor();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /关闭|Close/ })
            .click();
          await page
            .getByRole("button", { name: "Desktop text", exact: true })
            .click();
          await page
            .getByText("Desktop file preview\nSecond line", { exact: true })
            .waitFor();
          const refreshed = page.waitForResponse(
            (response) =>
              response.request().method() === "GET" &&
              new URL(response.url()).pathname === "/api/codex2/sessions/one",
          );
          await page.evaluate(() =>
            window.dispatchEvent(
              new CustomEvent("pocket-session-change", {
                detail: { agent: "codex2" },
              }),
            ),
          );
          await refreshed;
          assert.equal(await page.getByRole("dialog").isVisible(), true);
          const box = await page.getByRole("dialog").boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
          assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1);
          await page.screenshot({
            path: `artifacts/chat-files/${name}-${viewport.width}-text.png`,
          });
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /关闭|Close/ })
            .click();
          await page
            .getByRole("button", { name: "Desktop photo", exact: true })
            .click();
          await page.waitForFunction(() => {
            const image = document.querySelector(".file-preview-image");
            return image?.complete && image.naturalWidth > 0;
          });
          await page.screenshot({
            path: `artifacts/chat-files/${name}-${viewport.width}-image.png`,
          });
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /关闭|Close/ })
            .click();
          await page
            .getByRole("button", { name: "Desktop PDF", exact: true })
            .click();
          const pixel = () =>
            page.evaluate(() => {
              const c = document.querySelector(".pdf-preview canvas");
              return c?.width > 0
                ? [...c.getContext("2d").getImageData(10, 10, 1, 1).data]
                : null;
            });
          await page.waitForFunction(() => {
            const c = document.querySelector(".pdf-preview canvas");
            if (!c?.width) return false;
            const p = c.getContext("2d").getImageData(10, 10, 1, 1).data;
            return p[2] > 200 && p[0] < 50 && p[1] < 50;
          });
          assert.deepEqual(await pixel(), [0, 0, 255, 255]);
          await page
            .getByRole("button", { name: /^(下一页|Next page)$/ })
            .click();
          await page.waitForFunction(() => {
            const c = document.querySelector(".pdf-preview canvas");
            if (!c?.width) return false;
            const p = c.getContext("2d").getImageData(10, 10, 1, 1).data;
            return p[1] > 200 && p[0] < 50 && p[2] < 50;
          });
          assert.deepEqual(await pixel(), [0, 255, 0, 255]);
          assert.equal(
            await page
              .getByRole("button", { name: /^(下一页|Next page)$/ })
              .isDisabled(),
            true,
          );
          await page.screenshot({
            path: `artifacts/chat-files/${name}-${viewport.width}-pdf.png`,
          });
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /关闭|Close/ })
            .click();
          await page
            .getByRole("button", { name: "Desktop Markdown", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Desktop Notes", exact: true })
            .waitFor();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /关闭|Close/ })
            .click();
          await page
            .getByRole("button", { name: "HTML source", exact: true })
            .click();
          await page
            .getByText("<script>window.previewExecuted = true</script>", {
              exact: true,
            })
            .waitFor();
          assert.equal(
            await page.evaluate(() => window.previewExecuted),
            undefined,
          );
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /关闭|Close/ })
            .click();
          await page
            .getByRole("button", { name: "Missing file", exact: true })
            .click();
          await page.getByRole("dialog").getByRole("alert").waitFor();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /关闭|Close/ })
            .click();
          await input.fill("preserve this draft");
          await page.route("**/files/upload?**", (route) =>
            route.fulfill({
              status: 413,
              json: { error: "fixture upload rejected" },
            }),
          );
          await page
            .locator('input[type="file"]')
            .setInputFiles({
              name: "reject.txt",
              mimeType: "text/plain",
              buffer: Buffer.from("rejected"),
            });
          await page
            .getByRole("alert")
            .filter({ hasText: "fixture upload rejected" })
            .waitFor();
          assert.equal(await input.inputValue(), "preserve this draft");
          await page.unroute("**/files/upload?**");
          await input.fill("");
          let releaseUpload, uploadArrived;
          const uploadReady = new Promise((resolve) => {
            uploadArrived = resolve;
          });
          const uploadGate = new Promise((resolve) => {
            releaseUpload = resolve;
          });
          await page.route("**/files/upload?**", async (route) => {
            uploadArrived();
            await uploadGate;
            await route.continue();
          });
          await page
            .locator('input[type="file"]')
            .setInputFiles({
              name: "only attachment.txt",
              mimeType: "text/plain",
              buffer: Buffer.from("attachment without text"),
            });
          await uploadReady;
          assert.equal(
            await page
              .getByRole("button", { name: /^(发送|Send)$/ })
              .isDisabled(),
            true,
          );
          releaseUpload();
          await page.waitForFunction(() =>
            document
              .querySelector("textarea")
              .value.includes("only attachment.txt"),
          );
          await page.unroute("**/files/upload?**");
          const attachmentDraft = await input.inputValue();
          await page.route("**/sessions/one/messages", (route) =>
            route.fulfill({
              status: 503,
              json: { error: "fixture send rejected" },
            }),
          );
          await page.getByRole("button", { name: /^(发送|Send)$/ }).click();
          await page
            .getByRole("alert")
            .filter({ hasText: "fixture send rejected" })
            .waitFor();
          assert.equal(await input.inputValue(), attachmentDraft);
          assert.equal(messages.list("codex2", "one").length, 1);
          await page.unroute("**/sessions/one/messages");
          await page.getByRole("button", { name: /^(发送|Send)$/ }).click();
          await page.waitForFunction(
            () => document.querySelector("textarea").value === "",
          );
          assert.equal(messages.list("codex2", "one").length, 2);
          assert.equal(
            messages.list("codex2", "one")[1].text,
            attachmentDraft.trim(),
          );
          assert.deepEqual(failures, []);
          console.log(
            `${name} ${viewport.width}: uploads, durable drafts, newline/IME, authenticated previews, PDF pages/pixels, safe HTML and errors passed`,
          );
        } finally {
          await page.close();
          await messages.stop();
          app.locals.events.close();
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
