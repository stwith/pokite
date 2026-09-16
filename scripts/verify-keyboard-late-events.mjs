import {webkit} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const token=(await fs.readFile('.local/access-token','utf8')).trim();
const browser=await webkit.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 await page.addInitScript(()=>{window.vp={height:844,top:0};Object.defineProperty(visualViewport,'height',{get:()=>window.vp.height});Object.defineProperty(visualViewport,'offsetTop',{get:()=>window.vp.top})});
 await page.goto('http://127.0.0.1:3230/#token='+token);await page.locator('.session').first().waitFor({timeout:60000});await page.getByRole('button',{name:'关闭导航',exact:true}).tap();
 const input=page.getByRole('textbox',{name:'消息',exact:true});await input.fill('long draft\n'.repeat(30));await page.waitForTimeout(1200);
 await input.tap();await page.evaluate(()=>{window.vp={height:260,top:25}});await page.waitForTimeout(200);
 const first=await page.locator('.composer').boundingBox();assert.ok(first.y+first.height<=286,'already-focused tap catches geometry without resize event');
 await page.evaluate(()=>{const main=document.querySelector('.main');for(const cls of ['sync-banner','error-banner']){const node=document.createElement('div');node.className=cls;node.dataset.fixture='true';node.textContent='连接失败提示 '.repeat(80);main.insertBefore(node,document.querySelector('.conversation'))}});
 await page.waitForTimeout(100);const second=await page.locator('.composer').boundingBox();assert.ok(second.y+second.height<=286,'error banners cannot push composer below keyboard');
 await page.evaluate(()=>document.querySelectorAll('[data-fixture]').forEach(e=>e.remove()));await page.locator('textarea').blur();await page.evaluate(()=>{window.vp={height:844,top:0}});await page.waitForTimeout(200);
 const restored=await page.locator('.composer').boundingBox();assert.ok(restored.y+restored.height<=845);assert.ok(restored.y+restored.height>800);
 await page.screenshot({path:'artifacts/keyboard-late-events-webkit.png'});console.log('WebKit: repeated focus, missing resize events, long drafts, banners and dismissal passed');
}finally{await browser.close()}
