import {chromium,webkit} from "playwright";
import assert from "node:assert/strict";
for(const engine of [chromium,webkit]) {
 const browser=await engine.launch(engine===chromium?{channel:"chrome"}:{});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route("**/api/**",async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith("/events"))return route.abort();
   await route.fulfill({json:path.endsWith("/agents")?[{id:"fixture",name:"Fixture"}]:path.endsWith("/connection-links")?{lan:{url:"http://192.168.1.6:3230/"},tailscale:{url:"http://100.100.1.2:3230/"}}:[]});
  });
  await page.goto("http://127.0.0.1:3230/");
  await page.getByLabel("访问码",{exact:true}).fill("fixture-only-01234567890123456789");
  await page.getByRole("button",{name:"连接",exact:true}).click();
  await page.locator(".app").waitFor();
  if (!await page.getByRole("button",{name:"连接手机",exact:true}).isVisible())
    await page.getByRole("button",{name:"项目与会话",exact:true}).click();
  await page.getByRole("button",{name:"连接手机",exact:true}).click();
  await page.locator(".connection-secret").waitFor();
  assert.equal(await page.getByRole("button",{name:"复制链接",exact:true}).count(),1);
  assert.equal(await page.getByRole("button",{name:"复制访问码",exact:true}).count(),1);
  assert.equal(await page.locator(".connection-dialog").evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await page.screenshot({path:`artifacts/connection-layout-${engine.name()}.png`});
  await page.getByRole("button",{name:"关闭连接弹窗"}).click();
  await page.getByRole("button",{name:"退出连接",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"取消",exact:true}).click();
  assert.ok(await page.evaluate(()=>localStorage.getItem("access-token")));
  await page.getByRole("button",{name:"退出连接",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"退出连接",exact:true}).click();
  await page.locator(".login").waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem("access-token")),null);
  await page.reload();await page.locator(".login").waitFor();
  console.log(engine.name(),"connection layout, cancel, logout and reload passed");
 }finally{await browser.close();}
}
