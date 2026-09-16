import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium ? { channel: "chrome" } : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let queue = [
      {
        requestId: "q",
        state: "queued",
        text: "调整排队消息的展示。\n保留原来的项目与模型配置。",
      },
    ];
    const originalText = queue[0].text;
    const sentIds = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data;
      if (path === "/api/agents") data = [{ id: "codex2", name: "Codex 2" }];
      else if (path.endsWith("/projects"))
        data = [{ id: "p", name: "Project", path: "/tmp" }];
      else if (path.endsWith("/models"))
        data = { options: [], canSwitch: false };
      else if (path.endsWith("/sessions"))
        data = { items: [{ id: "s", title: "Queue", status: "running" }] };
      else if (path.endsWith("/withdraw")) {
        data = { text: queue[0].text };
        queue = [];
      } else if (path.endsWith("/messages")) {
        const body = route.request().postDataJSON();
        sentIds.push(body.requestId);
        data = { queued: true };
      } else
        data = {
          id: "s",
          projectId: "p",
          status: "running",
          messages: [],
          pending: [],
          queue,
        };
      await route.fulfill({ json: data });
    });
    await page.goto("http://127.0.0.1:3230/#token=isolated-browser-test");
    await page.locator(".session").first().click();
    const remove = page.getByRole("button", { name: "移除排队消息" });
    await remove.waitFor();
    const row = await page.locator(".queued-message").boundingBox();
    const container = await page.locator(".messages").boundingBox();
    assert.ok(row.width <= container.width * 0.8 + 1);
    assert.ok(Math.abs(row.x + row.width - container.x - container.width) < 2);
    const icon = await remove.boundingBox();
    assert.ok(icon.x > row.x + row.width / 2);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: `artifacts/queue-${engine.name()}.png` });
    const input = page.locator("textarea");
    await page.evaluate(
      (text) =>
        localStorage.setItem(
          "pending-send:codex2:s",
          JSON.stringify({
            id: "q",
            signature: JSON.stringify({
              agent: "codex2",
              sid: "s",
              projectId: "p",
              text,
            }),
          }),
        ),
      originalText,
    );
    await input.fill("已有草稿");
    await page.getByRole("button", { name: "撤回编辑" }).click();
    await page.waitForFunction(() =>
      document.querySelector("textarea").value.includes("调整排队"),
    );
    assert.equal(
      await input.inputValue(),
      "已有草稿\n\n调整排队消息的展示。\n保留原来的项目与模型配置。",
    );
    assert.equal(await page.locator(".queued-message").count(), 0);
    await input.fill(originalText);
    await input.press("Enter");
    await page.waitForFunction(
      () => document.querySelector("textarea").value === "",
    );
    assert.equal(sentIds.length, 1);
    assert.notEqual(sentIds[0], "q");
    assert.deepEqual(errors, []);
    console.log(engine.name(), "queue layout and withdraw-to-draft passed");
  } finally {
    await browser.close();
  }
}
