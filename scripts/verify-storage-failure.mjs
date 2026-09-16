import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium ? { channel: "chrome" } : {}),
  });
  try {
    for (const mode of ["quota", "unavailable"]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      let sends = 0;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((mode) => {
        window.storageBlocked = false;
        if (mode === "unavailable")
          Object.defineProperty(window, "localStorage", {
            get() {
              throw new DOMException("Blocked", "SecurityError");
            },
          });
        else {
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (window.storageBlocked)
              throw new DOMException("Full", "QuotaExceededError");
            return set.call(this, key, value);
          };
        }
      }, mode);
      await page.route("**/api/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        let data;
        if (pathname === "/api/agents")
          data = [{ id: "codex2", name: "Codex 2" }];
        else if (pathname.endsWith("/projects"))
          data = [{ id: "p", name: "Project", path: "/tmp" }];
        else if (pathname.endsWith("/models"))
          data = { options: [], canSwitch: false };
        else if (pathname.endsWith("/sessions"))
          data = {
            items: [{ id: "s", title: "Storage fixture", status: "idle" }],
          };
        else if (pathname.endsWith("/messages")) {
          sends++;
          data = { accepted: true };
        } else
          data = {
            id: "s",
            projectId: "p",
            title: "Storage fixture",
            status: "idle",
            messages: [],
            pending: [],
          };
        await route.fulfill({ json: data });
      });
      await page.goto("http://127.0.0.1:3230/#token=storage-fixture");
      await page.locator(".session").first().click();
      await page.evaluate(() => (window.storageBlocked = true));
      const input = page.locator("textarea");
      await input.fill("保留当前输入，不能丢失");
      await page
        .getByText("部分本地数据尚未保存。", { exact: false })
        .waitFor();
      await input.press("Enter");
      await page
        .getByText("草稿尚未保存，消息尚未发送", { exact: false })
        .waitFor();
      assert.equal(await input.inputValue(), "保留当前输入，不能丢失");
      assert.equal(sends, 0);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: `artifacts/storage-${engine.name()}-${mode}.png`,
      });
      if (mode === "quota") {
        await page.evaluate(() => {
          window.storageBlocked = false;
          window.dispatchEvent(new Event("focus"));
        });
        await input.press("Enter");
        await page.waitForFunction(
          () => document.querySelector("textarea").value === "",
        );
        assert.equal(sends, 1);
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        engine.name(),
        mode,
        "input preserved and unsafe send prevented",
      );
    }
  } finally {
    await browser.close();
  }
}
