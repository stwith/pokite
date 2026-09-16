import test from "node:test";
import assert from "node:assert/strict";
import { Dsh } from "../server/dsh.mjs";
import { Penguin } from "../server/penguin.mjs";
import { ClaudeDesktopRemote } from "../server/claude-desktop-remote.mjs";
test("DeepSeek exposes error details and does not let old failure override active execution",async()=>{
 let running=false;
 const a={projects:async()=>[{id:"p",sessionIds:["s"]}],call:async method=>method==="session.list"?{items:[{sessionId:"s",running}]}:{events:[{event:{type:"turn/error",data:{message:"Gateway 502"}}}]},row:()=>({status:running?"running":"idle"}),messages:()=>[],endStatus:Dsh.prototype.endStatus};
 assert.equal((await Dsh.prototype.detail.call(a,"s")).executionIssue.message,"Gateway 502");
 running=true;
 assert.equal((await Dsh.prototype.detail.call(a,"s")).executionIssue,undefined);
});
test("Penguin surfaces terminal errors",async()=>{
 const a={watch(){},call:async route=>route.includes("messages")?{messages:[{type:"event_msg",payload:{type:"task_end",status:"failed",error:{message:"Provider rejected request"}}}]}:{session:{}},row:()=>({status:"idle"}),messages:()=>[],outcomes:new Map()};
 const d=await Penguin.prototype.detail.call(a,"s");
 assert.equal(d.status,"failed");assert.equal(d.executionIssue.message,"Provider rejected request");
});
test("Cowork failure without diagnostics is explicit and clears on success",async()=>{
 const row={id:"s",remoteId:"remote",status:"failed"};
 const a={raw:async()=>[row],page:async()=>({messages:[]})};
 assert.match((await ClaudeDesktopRemote.prototype.detail.call(a,"s")).executionIssue.message,/未提供/);
 row.status="idle";
 assert.equal((await ClaudeDesktopRemote.prototype.detail.call(a,"s")).executionIssue,null);
});
