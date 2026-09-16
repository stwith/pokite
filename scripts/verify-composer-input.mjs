import {chromium,webkit} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const token=(await fs.readFile('.local/access-token','utf8')).trim();
for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...engine===chromium?{channel:'chrome'}:{}});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let sends=[];
    await page.addInitScript(()=>localStorage.setItem('agent','codex2'));
    await page.route('**/api/**',async route=>{
      const p=new URL(route.request().url()).pathname;let data;
      if(p==='/api/agents')data=[{id:'codex2',name:'Codex 2'}];
      else if(p.endsWith('/projects'))data=[{id:'p',name:'Project',path:'/tmp'}];
      else if(p.endsWith('/models'))data={current:'gpt-6',currentEffort:'low',canSwitch:true,options:[{id:'gpt-6',label:'GPT-6',efforts:['low','medium','high','xhigh','max','ultra']}]};
      else if(p.endsWith('/sessions'))data={items:[{id:'s',title:'Session',status:'idle'}],nextCursor:null};
      else if(p.endsWith('/messages')){sends.push(route.request().postDataJSON());await new Promise(r=>setTimeout(r,900));data={accepted:true,queued:true};}
      else data={id:'s',projectId:'p',title:'Session',status:'idle',canReply:true,messages:[{id:'m',role:'assistant',text:'Ready'}],pending:[]};
      await route.fulfill({json:data});
    });
    await page.goto('http://127.0.0.1:3230/#token='+token);
    await page.locator('.session').first().click();
    const effort=page.getByRole('combobox',{name:'推理强度',exact:true});await effort.click();
    assert.equal(await page.getByRole('option',{name:'low',exact:true}).count(),1);
    assert.equal(await page.getByRole('option').count(),6);
    await page.keyboard.press('Escape');
    const input=page.getByRole('textbox',{name:'消息',exact:true});
    await input.fill('line one');await input.press('Shift+Enter');await input.press('a');
    assert.equal(sends.length,0);assert.equal(await input.inputValue(),'line one\na');
    await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229,bubbles:true});
    assert.equal(sends.length,0);
    const sendButton=page.locator('button.send');
    await page.waitForTimeout(200);
    const appearance=()=>sendButton.evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,opacity:s.opacity,width:e.offsetWidth,height:e.offsetHeight}});
    const ready=await appearance();
    await input.press('Enter');
    await page.waitForFunction(()=>document.querySelector('button.send svg.spin'));
    const sending=await appearance();
    assert.equal(sending.opacity,'1');
    assert.equal(sending.background,ready.background);
    assert.equal(sending.color,ready.color);
    assert.equal(sending.width,ready.width);
    assert.equal(await sendButton.getAttribute('aria-busy'),'true');
    assert.equal(await sendButton.locator('.lucide-loader-circle').count(),1);
    await page.screenshot({path:`artifacts/composer-sending-${engine.name()}.png`});
    console.log(engine.name(),{ready,sending});
    await page.waitForFunction(()=>document.querySelector('textarea').value==='');
    await page.waitForFunction(()=>document.querySelector('button.send').getAttribute('aria-busy')==='false');
    assert.equal(await sendButton.getAttribute('aria-busy'),'false');
    assert.equal(await sendButton.isDisabled(),true);
    assert.equal(await sendButton.locator('.lucide-send').count(),1);
    assert.equal(sends.length,1);assert.equal(sends[0].text,'line one\na');
    await input.fill('long draft\n'.repeat(40));
    assert.equal(await input.evaluate(e=>getComputedStyle(e).scrollbarWidth),'none');
    await page.getByRole('button',{name:'发送',exact:true}).hover();await page.waitForTimeout(500);
    assert.equal(await page.getByRole('tooltip').count(),0);
    assert.equal(await page.locator('[title]').count(),0);
    console.log(engine.name(),'unique low, Enter send, Shift+Enter newline, IME guard, hidden scrollbar and no tooltip passed');
  }finally{await browser.close();}
}
