import {chromium,webkit} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const token=(await fs.readFile('.local/access-token','utf8')).trim();
const markdown=['## 双端连接检查','桌面和手机共用同一个后端。**已完成的任务**可以继续回复，新的消息会依次处理。','### 验证结果','- 桌面会话保留原有项目与目录。','- 手机发送后，在桌面查看结果。','  - 保留模型和推理强度。','  - 不重复提交同一条指令。','','> 当前任务仍在运行，后续消息已经排队。','','1. 打开已有项目。','2. 选择会话并发送消息。','','- [x] 连接验证','- [ ] 实机确认','','| 设备 | 状态 | 验证结果 |','| :--- | :---: | ---: |','| Mac mini | 已连接 | 通过 |','| iPad mini | 已连接 | 通过 |','','使用 `CODEX_HOME` 区分账号。参考 [项目文档](https://example.com)。','','```javascript','const result = await fetch("/api/sessions");','const sessions = await result.json();','console.log("session count", sessions.length);','const longLine = "'+ 'code '.repeat(50)+'";','```','','---','**下一步**：检查长内容下的滚动与阅读体验。'].join('\n');
for(const engine of [chromium,webkit]){
 const b=await engine.launch({headless:true,...engine===chromium?{channel:'chrome'}:{}});
 try{for(const width of [390,768,1440]){
  const p=await b.newPage({viewport:{width,height:1000},isMobile:width<1000,hasTouch:width<1000});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>localStorage.setItem('agent','codex2'));
  await p.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let data;
   if(path==='/api/agents')data=[{id:'codex2',name:'Codex 2'}];
   else if(path.endsWith('/projects'))data=[{id:'p',name:'Pokite',path:'/tmp'}];
   else if(path.endsWith('/models'))data={options:[],canSwitch:false};
   else if(path.endsWith('/sessions'))data={items:[{id:'s',title:'双端连接检查',status:'idle'}]};
   else data={id:'s',projectId:'p',title:'双端连接检查',status:'idle',messages:[{id:'m',role:'assistant',text:markdown,time:'2026-09-14T06:00:00Z'}],pending:[]};
   await route.fulfill({json:data});});
  await p.goto('http://127.0.0.1:3230/#token='+token);await p.locator('.session').first().click();await p.locator('.markdown-body h2').waitFor();
  await p.locator('.conversation').evaluate(e=>e.scrollTop=0);
  assert.ok(await p.locator('.hljs-keyword').count());assert.equal(await p.locator('.task-list-item input:checked').count(),1);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok(await p.locator('pre').evaluate(e=>e.scrollWidth>e.clientWidth));
  assert.equal(await p.locator('.message-meta').innerText().then(t=>t.includes('Codex')),false);
  assert.equal(await p.getByRole('tooltip').count(),0);assert.deepEqual(errors,[]);
  await p.screenshot({path:`artifacts/markdown-${engine.name()}-${width}.png`});
  await p.close();console.log(engine.name(),width,'Markdown layout passed');
 }}finally{await b.close();}
}
