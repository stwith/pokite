import test from "node:test";
import assert from "node:assert/strict";
import { Codex, codexFold } from "../server/codex.mjs";
test("native retry errors survive until completion and clear on next turn", () => {
  const adapter = {active:new Map(),pending:new Map(),accepted:new Map(),executionIssues:new Map()};
  const notify=(method,params)=>Codex.prototype.onMessage.call(adapter,{method,params});
  notify("error",{threadId:"a",turnId:"t",error:{message:"502 Bad Gateway"},willRetry:true});
  assert.equal(adapter.executionIssues.get("a").retrying,true);
  assert.equal(adapter.executionIssues.has("b"),false);
  notify("turn/completed",{threadId:"a",turn:{id:"t",error:{message:"Retry exhausted"}}});
  assert.equal(adapter.executionIssues.get("a").retrying,false);
  notify("turn/started",{threadId:"a",turn:{id:"next"}});
  assert.equal(adapter.executionIssues.has("a"),false);
  notify("error",{threadId:"a",error:{message:"temporary"},willRetry:true});
  notify("turn/completed",{threadId:"a",turn:{id:"next",status:"completed"}});
  assert.equal(adapter.executionIssues.has("a"),false);
});
test("persisted native errors preserve diagnostic text without parsing tool output",()=>{
  const state={messages:[]};
  codexFold({type:"event_msg",payload:{type:"error",message:"502 Bad Gateway"}},state);
  assert.equal(state.status,"failed");
  assert.equal(state.executionIssue.message,"502 Bad Gateway");
  codexFold({type:"event_msg",payload:{type:"task_started",turn_id:"new"}},state);
  assert.equal(state.executionIssue,null);
});
