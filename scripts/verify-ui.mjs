import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const token = (await fs.readFile(".local/access-token", "utf8")).trim();
const tests = [
  ...JSON.parse(await fs.readFile(".local/codex-tests.json", "utf8")),
  ...JSON.parse(await fs.readFile(".local/live-tests.json", "utf8")).filter(
    (x) => ["dsh", "penguin"].includes(x.agent),
  ),
];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = [];
await fs.mkdir("artifacts", { recursive: true });
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 960 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:3230/#token=" + token);
    await page.locator(".select-label select").first().waitFor();
    for (const agent of ["codex2", "dsh", "penguin", "codex"]) {
      await page.locator(".select-label select").first().selectOption(agent);
      const test = tests.find((x) => x.agent === agent);
      const response = await fetch(
        "http://127.0.0.1:3230/api/" + agent + "/sessions/" + test.id,
        { headers: { Authorization: "Bearer " + token } },
      );
      const detail = await response.json();
      const select = page.locator(".select-label select").nth(1);
      await page.waitForFunction(
        (id) =>
          Array.from(
            document.querySelectorAll(".select-label select")[1]?.options || [],
          ).some((x) => x.value === id),
        detail.projectId,
      );
      await select.selectOption(detail.projectId);
      const row = page.locator('[data-session-id="' + test.id + '"]');
      await row.waitFor({ timeout: 60000 });
      const layout=await row.evaluate(el=>{const rect=el.getBoundingClientRect();const status=el.querySelector('.session-status').getBoundingClientRect();return {height:rect.height,width:rect.width,statusGap:rect.right-status.right,nowrap:getComputedStyle(el.querySelector('.session-title')).whiteSpace}});
      assert.equal(layout.height,viewport.width<761?40:36,'compact single-line row height');
      assert.ok(layout.width>230,'session fills sidebar width');
      assert.ok(layout.statusGap<=12,'status aligned at trailing edge');
      assert.equal(layout.nowrap,'nowrap');
      if(viewport.width===390&&agent==='codex2')await page.screenshot({path:'artifacts/shadcn-sidebar-390.png'});
      if(viewport.width===1440&&agent==='codex2')await page.screenshot({path:'artifacts/shadcn-sidebar-1440.png'});
      await row.click();
      await page
        .locator(".message.assistant")
        .filter({ hasText: "POCKET_REPLY_OK" })
        .waitFor({ timeout: 60000 });
      assert.ok(
        (await page.locator(".message.user").count()) >= 2,
        "human messages shown",
      );
      assert.equal(
        await page
          .locator(".message.user")
          .filter({
            hasText:
              /Current runtime context|<environment_context>|<recommended_plugins>/,
          })
          .count(),
        0,
        "synthetic context hidden",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "no page horizontal overflow",
      );
      await page.screenshot({
        path: `artifacts/${viewport.width}-${agent}.png`,
        fullPage: true,
      });
      if (viewport.width < 761)
        await page
          .getByRole("button", { name: "项目与会话", exact: true })
          .click();
      report.push({ width: viewport.width, agent, chat: true, rowHeight:layout.height });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(
  "artifacts/ui-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
