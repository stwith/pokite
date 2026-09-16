import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { channel: "chrome" } : {});
  try {
    for (const standalone of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 },
        ...(engine === webkit ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" } : {}) });
      if (standalone) await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("http://127.0.0.1:3230/");
      await page.getByRole("heading", { name: "Pokite 口袋风筝" }).waitFor();
      await page.waitForTimeout(100);
      assert.equal(await page.locator("link[rel=manifest]").getAttribute("href"), "/manifest.webmanifest");
      const manifest = await (await page.request.get("http://127.0.0.1:3230/manifest.webmanifest")).json();
      assert.equal(manifest.display, "standalone");
      assert.equal(manifest.start_url, "/");
      assert.ok(!JSON.stringify(manifest).includes("token"));
      for (const icon of manifest.icons) {
        const response = await page.request.get("http://127.0.0.1:3230" + icon.src);
        assert.equal(response.status(), 200);
        assert.match(response.headers()["content-type"], /image\/png/);
      }
      assert.equal(await page.locator(".home-screen-guide").count(), standalone ? 0 : 1);
      if (!standalone) {
        await page.locator(".home-screen-guide summary").click();
        if (engine === webkit) assert.match(await page.locator(".home-screen-guide").innerText(), /Safari/);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/home-screen-${engine.name()}-${standalone}.png` });
      await page.close();
    }
    console.log(engine.name(), "manifest, icons, first connection and standalone guidance passed");
  } finally { await browser.close(); }
}
