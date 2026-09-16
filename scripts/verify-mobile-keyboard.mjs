import { chromium, webkit } from "playwright";
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
const results = [];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(
    engine === chromium
      ? { channel: "chrome", headless: true }
      : { headless: true },
  );
  try {
    for (const size of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 844, height: 390 },
    ]) {
      const page = await browser.newPage({
        viewport: size,
        isMobile: true,
        hasTouch: true,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(({ width, height }) => {
        window.keyboardViewport = { width, height, top: 0, left: 0, scale: 1 };
        const v = visualViewport;
        for (const k of ["height", "width", "scale"])
          Object.defineProperty(v, k, {
            get: () => window.keyboardViewport[k],
          });
        Object.defineProperty(v, "offsetTop", {
          get: () => window.keyboardViewport.top,
        });
        Object.defineProperty(v, "offsetLeft", {
          get: () => window.keyboardViewport.left,
        });
      }, size);
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
      const input = page.getByRole("textbox", { name: "消息", exact: true });
      async function viewport(state, emit = true) {
        await page.evaluate(
          ({ state, emit }) => {
            Object.assign(window.keyboardViewport, state);
            if (emit) {
              visualViewport.dispatchEvent(new Event("resize"));
              visualViewport.dispatchEvent(new Event("scroll"));
            }
          },
          { state, emit },
        );
        await page.waitForTimeout(120);
      }
      async function check(label) {
        const metrics = await page.evaluate(() => {
          const v = window.keyboardViewport;
          const c = document.querySelector(".composer").getBoundingClientRect(),
            t = document
              .querySelector(".composer textarea")
              .getBoundingClientRect(),
            send = document.querySelector(".send").getBoundingClientRect();
          return {
            bottom: v.top + v.height,
            right: v.left + v.width,
            top: v.top,
            composer: c.bottom,
            inputTop: t.top,
            inputBottom: t.bottom,
            sendBottom: send.bottom,
            sendRight: send.right,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert.ok(
          metrics.composer <= metrics.bottom + 1,
          JSON.stringify({ label, metrics, size, engine: engine.name() }),
        );
        assert.ok(metrics.inputTop >= metrics.top - 1);
        assert.ok(metrics.inputBottom <= metrics.bottom + 1);
        assert.ok(metrics.sendBottom <= metrics.bottom + 1);
        assert.ok(metrics.sendRight <= metrics.right + 1);
        assert.equal(metrics.overflow, false);
      }
      const openHeight = size.height < 500 ? 160 : 420;
      for (let cycle = 0; cycle < 4; cycle++) {
        await input.fill(cycle % 2 ? "长草稿\n".repeat(30) : "短草稿");
        await input.focus();
        await viewport({
          height: openHeight + 80,
          width: size.width,
          top: 0,
          left: 0,
          scale: 1,
        });
        await check("opening");
        await viewport({
          height: openHeight,
          width: size.width / 1.01,
          top: 35,
          left: 2,
          scale: 1.01,
        });
        await check("fractional scale");
        await viewport({
          height: openHeight - 15,
          width: size.width / 1.15,
          top: 50,
          left: 10,
          scale: 1.15,
        });
        await check("zoom and pan");
        await input.blur();
        await viewport({ height: openHeight, top: 20, scale: 1 });
        await viewport({ ...size, top: 0, left: 0, scale: 1 }, false);
        await page.waitForTimeout(250);
        await check("close without final resize event");
      }
      await input.fill("first draft");
      await viewport({ height: openHeight, top: 0, scale: 1 });
      await input.focus();
      let release;
      const gate = new Promise((r) => {
        release = r;
      });
      let posted,
        count = 0;
      await page.route(
        "**/api/codex2/sessions/" + id + "/messages",
        async (r) => {
          count++;
          posted = r.request().postDataJSON();
          await gate;
          await r.fulfill({
            status: 200,
            contentType: "application/json",
            body: '{"accepted":true}',
          });
        },
      );
      await page.getByRole("button", { name: "发送", exact: true }).tap();
      await page.waitForTimeout(100);
      assert.equal(await input.isDisabled(), false);
      assert.equal(
        await input.evaluate((e) => document.activeElement === e),
        true,
        "send keeps focus",
      );
      await input.fill("next draft while sending");
      release();
      await page.waitForTimeout(500);
      assert.equal(count, 1, "touch submits exactly once");
      assert.equal(posted.text, "first draft");
      assert.equal(await input.inputValue(), "next draft while sending");
      await check("send and next draft");
      await input.blur();
      assert.equal(
        await input.evaluate((e) => document.activeElement === e),
        false,
      );
      await viewport({ height: size.height, top: 0, scale: 1 });
      await check("explicit dismiss");
      if (size.width === 390) {
        await page
          .getByRole("button", { name: "项目与会话", exact: true })
          .tap();
        await page
          .getByRole("textbox", { name: "搜索会话", exact: true })
          .fill("POCKET");
        await viewport({ height: 240, top: 20 });
        const sheet = await page
          .locator('[data-slot="sheet-content"]')
          .boundingBox();
        assert.ok(
          sheet.y + sheet.height <= 261,
          "sidebar fits search keyboard",
        );
        assert.ok(
          (await page.locator(".sidebar nav").evaluate((e) => e.clientHeight)) >
            40,
          "search results keep scroll space",
        );
        await page.getByRole("button", { name: "关闭导航", exact: true }).tap();
        await viewport({ ...size, top: 0 });
        await check("search keyboard closed");
      }
      assert.ok(
        Number(
          await input.evaluate((e) =>
            getComputedStyle(e).fontSize.replace("px", ""),
          ),
        ) >= 16,
        "touch font does not auto-zoom",
      );
      await page.screenshot({
        path: `artifacts/keyboard-${engine.name()}-${size.width}.png`,
      });
      assert.deepEqual(errors, []);
      results.push({ engine: engine.name(), ...size, cycles: 4, passed: true });
      console.log(results.at(-1));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
await fs.writeFile(
  "artifacts/mobile-keyboard-verification.json",
  JSON.stringify(results, null, 2),
);
