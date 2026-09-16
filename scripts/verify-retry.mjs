import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const token = (await fs.readFile(".local/access-token", "utf8")).trim();
const { id } = JSON.parse(
  await fs.readFile(".local/codex-tests.json", "utf8"),
).find((x) => x.agent === "codex2");
const detail = await (
  await fetch("http://127.0.0.1:3230/api/codex2/sessions/" + id, {
    headers: { Authorization: "Bearer " + token },
  })
).json();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const ids = [],
  payloads = [];
try {
  await page.route(
    "**/api/codex2/sessions/" + id + "/messages",
    async (route) => {
      payloads.push(route.request().postDataJSON());
      ids.push(route.request().postDataJSON().requestId);
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simulated lost response" }),
      });
    },
  );
  await page.goto("http://127.0.0.1:3230/#token=" + token);
  async function open() {
    await page.waitForFunction(
      (pid) =>
        Array.from(
          document.querySelectorAll(".select-label select")[1]?.options || [],
        ).some((o) => o.value === pid),
      detail.projectId,
    );
    await page
      .locator(".select-label select")
      .nth(1)
      .selectOption(detail.projectId);
    await page.locator('[data-session-id="' + id + '"]').click();
    await page.locator(".message.assistant").first().waitFor();
  }
  await open();
  await page.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", { name: "GPT-5.6-Sol", exact: true })
    .last()
    .click({ noWaitAfter: true });
  assert.equal(new URL(page.url()).pathname, "/");
  await page.getByRole("combobox", { name: "推理强度", exact: true }).click();
  await page
    .getByRole("option", { name: "low", exact: true })
    .last()
    .click({ noWaitAfter: true });
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("Browser retry fixture; never dispatched");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Simulated lost response" })
    .waitFor();
  await page.reload();
  await open();
  assert.equal(
    await page.getByRole("textbox", { name: "消息", exact: true }).inputValue(),
    "Browser retry fixture; never dispatched",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Simulated lost response" })
    .waitFor();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  console.log(
    "Reload preserves draft and request identity; no native task dispatched",
  );
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal(payloads[1].effort, "low");
  assert.equal(payloads[1].modelId, "gpt-5.6-sol");
} finally {
  await browser.close();
}
