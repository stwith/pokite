import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? {channel:"chrome"} : {});
  try { for (const width of [390, 1440]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    await page.route("**/api/**",async route=>{
      const path=new URL(route.request().url()).pathname;
      const data=path.endsWith("/agents")?[{id:"demo",name:"Demo"}]:path.endsWith("/projects")?[{id:"p",name:"Project"}]:path.endsWith("/models")?{options:[]}:path.endsWith("/sessions")?{items:[{id:"s",title:"Session"}]}:{id:"s",projectId:"p",status:"idle",messages:[{id:"a",role:"assistant",text:"Assistant message"},{id:"u",role:"user",text:"好的"},{id:"l",role:"user",text:"长内容 ".repeat(80)+"\n\n```text\n"+"long_code_".repeat(50)+"\n```"}],pending:[]};
      await route.fulfill({json:data});
    });
    await page.goto("http://127.0.0.1:3230/#token=fixture-only-0123456789");
    await page.locator(".session").first().click();
    await page.locator(".message.user").first().waitFor();
    const box=await page.locator(".messages").boundingBox();
    for(const el of await page.locator(".message.user").all()) {
      const b=await el.boundingBox();
      assert.ok(b.width<=box.width*0.8+1);
      assert.ok(Math.abs(b.x+b.width-box.x-box.width)<2);
    }
    assert.ok((await page.locator(".message.user").first().boundingBox()).width<box.width*0.8);
    assert.equal(await page.locator(".conversation").evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await page.locator(".conversation").evaluate(e=>e.scrollTop=0);
    await page.screenshot({path:`artifacts/user-bubbles-${engine.name()}-${width}.png`});
    await page.close();console.log(engine.name(),width,"right aligned 80% user bubbles passed");
  }} finally {await browser.close();}
}
