import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

// QR screenshots contain credentials. Keep them in memory, never in artifacts.
const token = (await fs.readFile(".local/access-token", "utf8")).trim();
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { channel: "chrome", args: ["--no-proxy-server"] } : {});
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await desktop.addInitScript(value => localStorage.setItem("access-token", value), token);
    const host = await desktop.newPage();
    await host.goto("http://127.0.0.1:3230/", { waitUntil: "domcontentloaded" });
    await host.getByRole("button", { name: "连接手机", exact: true }).click();
    for (const mode of ["本地局域网", "Tailscale"]) {
      await host.getByRole("tab", { name: mode, exact: true }).click();
      const canvas = host.getByRole("img", { name: mode + "连接二维码", exact: true });
      await canvas.waitFor();
      await host.waitForFunction(label => {
        const c = document.querySelector(`canvas[aria-label="${label}"]`);
        return c && c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0);
      }, mode + "连接二维码");
      const buffer = await canvas.screenshot();
      const phone = await browser.newContext({viewport:{width:390,height:844}});
      const page = await phone.newPage();
      try {
        await page.goto("http://127.0.0.1:3230/", {waitUntil:"domcontentloaded"});
        await page.getByLabel("拍摄二维码图片",{exact:true}).setInputFiles({name:"actual-qr.png",mimeType:"image/png",buffer});
        await page.locator(".login").waitFor({state:"detached",timeout:30000});
        assert.equal(await page.evaluate(()=>localStorage.getItem("access-token")),token);
        await page.reload({waitUntil:"domcontentloaded"});
        await page.locator(".app").waitFor();
        console.log(engine.name(), mode, "actual dialog QR -> actual authentication -> persisted login passed");
      } finally {await phone.close();}
    }
    await desktop.close();
  } finally {await browser.close();}
}
