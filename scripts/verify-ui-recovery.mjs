import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const token = (await fs.readFile(".local/access-token", "utf8")).trim();
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium ? { channel: "chrome" } : {}),
  });
  try {
    for (const width of process.env.POCKET_QUICK
      ? [390]
      : [320, 390, 768, 1440]) {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        isMobile: width < 1000,
        hasTouch: width < 1000,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        localStorage.setItem("agent", "dsh");
        window.testHeight = 844;
        Object.defineProperty(visualViewport, "height", {
          get: () => window.testHeight,
        });
      });
      await page.route("**/api/**", async (route) => {
        const p = new URL(route.request().url()).pathname;
        const detail = {
          id: "s",
          projectId: "p",
          title: "Read session",
          status: "idle",
          canReply: true,
          model: "m",
          messages: [{ id: "a", role: "assistant", text: "Already read" }],
          pending: [],
          unread: false,
        };
        let data;
        if (p === "/api/agents")
          data = [{ id: "dsh", name: "DeepSeek Harness" }];
        else if (p.endsWith("/projects"))
          data = [{ id: "p", name: "Working project", path: "/tmp" }];
        else if (p.endsWith("/models"))
          data = {
            options: [
              { id: "m", label: "DeepSeek Model", efforts: ["low", "high"] },
            ],
            current: "m",
            currentEffort: "high",
            canSwitch: true,
          };
        else if (p.endsWith("/sessions"))
          data = { items: [detail], nextCursor: null };
        else data = detail;
        await route.fulfill({ json: data });
      });
      await page.goto("http://127.0.0.1:3230/#token=" + token);
      const project = page.getByRole("combobox", { name: "项目", exact: true });
      await project.waitFor();
      await page.locator(".session").first().waitFor();
      assert.ok(
        await page
          .locator("select")
          .evaluateAll((els) =>
            els.every(
              (e) =>
                e.getAttribute("aria-hidden") === "true" &&
                e.tabIndex === -1 &&
                getComputedStyle(e).clip !== "auto",
            ),
          ),
      );
      for (const name of ["Agent", "项目"]) {
        const el = page.getByRole("combobox", { name, exact: true });
        assert.equal((await el.boundingBox()).height, 44);
        await el.click({ noWaitAfter: true });
        await page.getByRole("listbox").waitFor();
        if (name === "项目")
          await page.screenshot({
            path: `artifacts/recovery-menu-${engine.name()}-${width}.png`,
          });
        await page.keyboard.press("Escape");
      }
      await page.locator(".session").first().click({ noWaitAfter: true });
      const input = page.getByRole("textbox", { name: "消息", exact: true });
      await input.waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: /展开输入框|收起输入框/ })
          .count(),
        0,
      );
      const style = async (name) =>
        page.getByRole("combobox", { name, exact: true }).evaluate((e) => {
          const c = getComputedStyle(e);
          return [c.borderWidth, c.fontSize, c.height, c.backgroundColor];
        });
      await page
        .getByRole("combobox", { name: "推理强度", exact: true })
        .waitFor();
      assert.deepEqual(await style("模型"), await style("推理强度"));
      for (let cycle = 0; cycle < 3; cycle++) {
        await input.fill("short");
        const small = (await input.boundingBox()).height;
        await input.fill("Long text\n".repeat(25));
        await page.evaluate(() => {
          window.testHeight = 400;
          visualViewport.dispatchEvent(new Event("resize"));
        });
        await page.waitForTimeout(160);
        const bounds = await input.boundingBox();
        assert.ok(bounds.height > small + 80);
        assert.ok(bounds.y + bounds.height <= 400);
        const composer = await page.locator(".composer").boundingBox();
        assert.ok(composer.y + composer.height <= 401);
        assert.equal(await page.locator(".keyboard-dismiss").count(), 0);
        await page.evaluate(() => {
          window.testHeight = 844;
          visualViewport.dispatchEvent(new Event("resize"));
        });
        await input.fill("short");
        await page.waitForTimeout(160);
        assert.ok((await input.boundingBox()).height <= small + 2);
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: `artifacts/recovery-composer-${engine.name()}-${width}.png`,
      });
      await page.close();
      console.log(
        engine.name(),
        width,
        "unified menus and auto-height keyboard cycles passed",
      );
    }
  } finally {
    await browser.close();
  }
}
