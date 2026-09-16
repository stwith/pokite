import { chromium, webkit } from "playwright";
import QRCode from "qrcode";
import assert from "node:assert/strict";
const token = "pairing-fixture-0123456789";
const png = await QRCode.toBuffer("http://192.168.1.6:3230/#token=" + token, { width: 264, margin: 4, errorCorrectionLevel: "M" });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { channel: "chrome" } : {});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await page.route("**/api/**", async route => {
      if(route.request().headers().authorization !== "Bearer " + token)
        return route.fulfill({status:401,json:{error:"unauthorized"}});
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({json:path.endsWith("/agents") ? [{id:"fixture",name:"Fixture"}] : []});
    });
    await page.goto("http://127.0.0.1:3230/");
    const photo = await page.evaluate(async data => {
      const image = new Image(); image.src = data; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width=3000;canvas.height=4000;
      const ctx=canvas.getContext("2d");ctx.fillStyle="#ccc";ctx.fillRect(0,0,3000,4000);
      ctx.save();ctx.translate(1500,2000);ctx.rotate(0.12);ctx.drawImage(image,-132,-132,264,264);ctx.restore();
      return canvas.toDataURL("image/jpeg",0.85).split(",")[1];
    },"data:image/png;base64,"+png.toString("base64"));
    await page.getByLabel("拍摄二维码图片",{exact:true}).setInputFiles({name:"camera.jpg",mimeType:"image/jpeg",buffer:Buffer.from(photo,"base64")});
    await page.locator(".login").waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>localStorage.getItem("access-token")),token);
    assert.equal(new URL(page.url()).origin,"http://127.0.0.1:3230");
    assert.equal(await page.locator(".login").count(),0);
    await page.reload();
    await page.locator(".app").waitFor();
    console.log(engine.name(),"QR photo pairing and remembered authentication passed");
    await page.close();
  } finally {await browser.close();}
}
