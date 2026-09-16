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
        hasTouch: width < 1000,
        isMobile: width < 1000,
      });
      const errors = [];
      if (engine === webkit)
        await page.addInitScript(() => {
          const original = CSS.supports.bind(CSS);
          CSS.supports = (...args) =>
            args[0] === "field-sizing" ? false : original(...args);
        });
      page.on("pageerror", (e) => errors.push(e.message));
      let sent;
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url()),
          p = url.pathname;
        let data;
        if (p === "/api/agents") data = [{ id: "codex2", name: "Codex 2" }];
        else if (p.endsWith("/projects"))
          data = [
            {
              id: "p",
              name: "A long project name for alignment",
              path: "/tmp",
            },
          ];
        else if (p.endsWith("/models"))
          data = {
            options: [
              {
                id: "m",
                label: "GPT model with long name",
                efforts: ["low", "high"],
              },
            ],
            current: "m",
            currentEffort: "low",
            canSwitch: true,
          };
        else if (p.endsWith("/messages")) {
          sent = route.request().postDataJSON();
          data = { accepted: true, queued: true };
        } else if (p.endsWith("/sessions")) {
          const limit = Number(url.searchParams.get("limit") || 40);
          data = {
            items: Array.from({ length: Math.min(limit, 90) }, (_, i) => ({
              id: "s" + i,
              title: "Session " + i,
              status: "running",
              updatedAt: 1,
            })),
            nextCursor: limit < 90 ? String(limit) : null,
          };
        } else
          data = {
            id: "s0",
            projectId: "p",
            status: "running",
            canReply: false,
            model: "m",
            messages: [{ id: "x", role: "assistant", text: "Working" }],
            pending: [],
            queue: sent
              ? [{ requestId: "q", text: sent.text, state: "queued" }]
              : [],
          };
        await route.fulfill({ json: data });
      });
      await page.goto("http://127.0.0.1:3230/#token=" + token);
      await page.locator(".session").first().waitFor();
      for (const select of await page.locator(".select-label select").all()) {
        const box = await select.boundingBox();
        assert.ok(box.height >= 44);
        const css = await select.evaluate((e) => {
          const s = getComputedStyle(e);
          return {
            font: parseFloat(s.fontSize),
            padding: parseFloat(s.paddingTop) + parseFloat(s.paddingBottom),
            height: e.clientHeight,
          };
        });
        assert.ok(
          css.height - css.padding >= css.font + 4,
          "selector text is not clipped",
        );
      }
      await page.getByRole("button", { name: "加载更多", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".session").length === 80,
      );
      await page.locator(".session").first().click();
      const input = page.getByRole("textbox", { name: "消息", exact: true });
      await input.fill("A queued follow-up");
      assert.equal(
        await page
          .getByRole("button", { name: "发送", exact: true })
          .isEnabled(),
        true,
      );
      const model = page.getByRole("combobox", { name: "模型", exact: true });
      assert.equal(
        await model.evaluate((e) => getComputedStyle(e).fontSize),
        "13px",
      );
      await page
        .getByRole("combobox", { name: "推理强度", exact: true })
        .click();
      await page.getByRole("option", { name: "high", exact: true }).click();
      await page.getByRole("button", { name: "发送", exact: true }).click();
      assert.equal(sent.effort, "high");
      await page.getByText("排队中", { exact: true }).waitFor();
      await input.fill("Long draft\n".repeat(24));
      await page
        .getByRole("button", { name: "展开输入框", exact: true })
        .click();
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, "height", {
          configurable: true,
          get: () => 420,
        });
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await page.waitForTimeout(150);
      const metrics = await page.evaluate(() => {
        const t = document.querySelector("textarea").getBoundingClientRect(),
          c = document.querySelector(".composer").getBoundingClientRect();
        return {
          inputHeight: t.height,
          bottom: c.bottom,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.ok(metrics.inputHeight >= 160, JSON.stringify(metrics));
      assert.ok(metrics.bottom <= 421, JSON.stringify(metrics));
      assert.equal(metrics.overflow, false);
      await page
        .getByRole("combobox", { name: "推理强度", exact: true })
        .click();
      const menu = await page.getByRole("listbox").boundingBox();
      assert.ok(
        menu.y >= 0 && menu.y + menu.height <= 421,
        JSON.stringify(menu),
      );
      await page.keyboard.press("Escape");
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: `artifacts/mobile-controls-${engine.name()}-${width}.png`,
      });
      await page.close();
      console.log(
        engine.name(),
        width,
        "controls, queue, pagination, expanded keyboard passed",
      );
    }
  } finally {
    await browser.close();
  }
}
