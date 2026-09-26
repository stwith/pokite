import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
const app=express();app.use(express.json());
let configured=false;const calls=[];
app.get('/api/agents',(_,res)=>res.json([]));
app.get('/api/setup/discovery',(_,res)=>res.json({needsSave:false,instances:[],candidates:[
 {id:'codex',name:'Codex',provider:'codex',status:'sharing-configured'},
 {id:'codex2',name:'Codex 2',provider:'codex',status:configured?'sharing-configured':'needs-desktop-connection',...(!configured?{setupAction:'codex'}:{})},
 {id:'dsh',name:'DeepSeek Harness',status:'endpoint-discovered'},
 {id:'penguin',name:'PenguinHarness',status:'service-not-running'},
 {id:'claude',name:'Claude Code',status:'native-history-found'},
 {id:'hermes',name:'Hermes Desktop',status:'plugin-installed'},
]}));
app.post('/api/setup/configure',(req,res)=>{calls.push(req.body);configured=true;res.json({ok:true});});
app.use(express.static('dist'));
const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
await fs.mkdir('artifacts/settings-ui',{recursive:true});
try {
 for(const [name,engine] of Object.entries({chromium,webkit})) {
  const browser=await engine.launch({headless:true});
  try {
   for(const [mode,locale,width,height] of [['desktop','zh-CN',1280,850],['mobile','zh-CN',390,844],['english','en-US',1280,850]]) {
    configured=false;
    const page=await browser.newPage({locale,viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#token=fixture`);
    await page.locator('.sidebar footer').waitFor();
    assert.equal(await page.locator('.sidebar footer button').count(),2);
    await page.getByRole('button',{name:mode==='english'?'Settings':'设置',exact:true}).click();
    await page.getByRole('button',{name:mode==='english'?'Agent connections':'Agent 接入',exact:true}).click();
    await page.locator('.setup-results li').first().waitFor();
    assert.equal(await page.locator('.setup-results button').count(),1);
    const body=await page.locator('.setup-results').innerText();assert.ok(!body.includes('sharing-configured'));
    assert.ok(body.includes(mode==='english'?'Sharing configured':'共享已配置'));
    assert.equal(await page.getByRole('button',{name:mode==='english'?'Add to Pokite':'添加到 Pokite',exact:true}).count(),0);
    const dialog=page.locator('[role="dialog"]').last();const box=await dialog.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width+1);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.screenshot({path:`artifacts/settings-ui/${name}-${mode}.png`});
    await page.locator('.setup-results button').click();
    await page.waitForFunction(()=>document.querySelectorAll('.setup-results button').length===0);
    assert.deepEqual(calls.at(-1),{action:'codex',instanceId:'codex2'});
    assert.deepEqual(errors,[]);
    await page.close();console.log(name+' '+mode+': compact footer, translated states, scoped action and refresh passed');
   }
   const firstRun=await browser.newPage();
   await firstRun.goto(`http://127.0.0.1:${server.address().port}/?setup=1#token=fixture`);
   await firstRun.locator('.setup-results').waitFor();
   await firstRun.close();
   console.log(name+': first-run setup link still opens directly');
  }finally{await browser.close();}
 }
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
