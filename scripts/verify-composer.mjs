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
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const v = window.visualViewport;
    window.testViewport = { height: 844, top: 0 };
    Object.defineProperty(v, "height", {
      get: () => window.testViewport.height,
    });
    Object.defineProperty(v, "offsetTop", {
      get: () => window.testViewport.top,
    });
  });
  await page.goto("http://127.0.0.1:3230/#token=" + token);
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
  assert.equal(
    await page
      .locator(".message.user .message-meta")
      .first()
      .innerText()
      .then((t) => t.includes("你")),
    false,
  );
  await page.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", { name: "GPT-5.6-Sol", exact: true })
    .last()
    .click();
  let sent;
  await page.route(
    "**/api/codex2/sessions/" + id + "/messages",
    async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Fixture: no task sent" }),
      });
    },
  );
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("Model-selection UI fixture");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fixture" }).waitFor();
  assert.equal(sent.modelId, "gpt-5.6-sol");
  await page.getByRole("button", { name: "关闭提示", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).focus();
  const report = [];
  for (const [height, top] of [
    [460, 0],
    [390, 70],
    [844, 0],
  ]) {
    await page.evaluate(
      ({ height, top }) => {
        Object.assign(window.testViewport, { height, top });
        visualViewport.dispatchEvent(new Event("resize"));
        visualViewport.dispatchEvent(new Event("scroll"));
      },
      { height, top },
    );
    await page.waitForTimeout(150);
    const rect = await page.locator(".composer").boundingBox();
    const gap = top + height - (rect.y + rect.height);
    assert.ok(gap >= 0 && gap <= 15, `composer gap ${gap}`);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    report.push({ height, top, gap });
    await page.screenshot({ path: `artifacts/composer-${height}-${top}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
  await fs.writeFile(
    "artifacts/composer-verification.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
