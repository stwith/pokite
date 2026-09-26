import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DeviceAuth } from "../server/device-auth.mjs";
import { Operations } from "../server/operations.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
import { renderDesktopLauncher } from "../server/sharing-setup.mjs";
import { listenAddresses } from "../server/listen-addresses.mjs";
import { ClaudeDesktopClient } from "../server/claude-desktop-client.mjs";
import express from "express";
import http from "node:http";
import { installHttpProtection } from "../server/http-middleware.mjs";

test("pairing tickets cannot read sessions and revocation closes an existing stream", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pokite-auth-http-"));
  const auth=new DeviceAuth(path.join(dir,"devices.json"),"master-fixture");
  const app=express();const server=http.createServer(app);
  installHttpProtection(app,{token:"master-fixture",getPort:()=>server.address().port,devices:auth});
  app.get("/api/example/events",(req,res)=>{res.setHeader("Content-Type","text/event-stream");res.write("data: ready\n\n");});
  app.get("/api/example/sessions",(req,res)=>res.json([]));
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const ticket=auth.pairingToken();
    assert.equal((await fetch(base+"/api/example/sessions",{headers:{Authorization:"Bearer "+ticket}})).status,403);
    const device=auth.pair(auth.verify(ticket),"Fixture");
    const headers={Authorization:"Bearer "+device.token};
    const r=await fetch(base+"/api/example/events",{headers,signal:AbortSignal.timeout(5000)});
    const reader=r.body.getReader();assert.equal((await reader.read()).done,false);
    auth.revoke(device.id);
    assert.equal((await reader.read()).done,true);
    assert.equal((await fetch(base+"/api/example/sessions",{headers})).status,401);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), "pokite-audit-"));

test("device tokens are independent, persisted as hashes and individually revocable", () => {
  const dir = fixture();
  try {
    const auth = new DeviceAuth(
      path.join(dir, "devices.json"),
      "bootstrap-secret",
    );
    const code = auth.pairingToken();
    const a = auth.pair(auth.verify(code), "Phone");
    assert.equal(auth.verify(code), null);
    const b = auth.pair(auth.verify("bootstrap-secret"), "Tablet");
    assert.notEqual(a.token, b.token);
    assert.ok(!fs.readFileSync(auth.file, "utf8").includes(a.token));
    auth.revoke(a.id);
    const next = new DeviceAuth(auth.file, "bootstrap-secret");
    assert.equal(next.verify(a.token), null);
    assert.equal(next.verify(b.token).id, b.id);
    assert.deepEqual(auth.pair(next.verify(b.token), "same"), {
      existing: true,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("queue rejects same request ID for another instance, session, text or model", () => {
  const dir = fixture();
  try {
    const q = new MessageQueue(path.join(dir, "q.json"), {});
    q.add("a", "one", "hello", "request", { id: "m" });
    for (const input of [
      ["b", "one", "hello", { id: "m" }],
      ["a", "two", "hello", { id: "m" }],
      ["a", "one", "different", { id: "m" }],
      ["a", "one", "hello", { id: "other" }],
    ])
      assert.throws(
        () => q.add(input[0], input[1], input[2], "request", input[3]),
        { status: 409 },
      );
    assert.equal(q.items.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("retention removes sensitive results but old requests never execute twice", async () => {
  const dir = fixture();
  try {
    const op = new Operations(path.join(dir, "op.json"));
    await op.run("old-request-id", { text: "hello" }, async () => ({
      text: "private response",
    }));
    op.records["old-request-id"].finishedAt = 1;
    op.save();
    assert.ok(!fs.readFileSync(op.file, "utf8").includes("private response"));
    await assert.rejects(
      new Operations(op.file).run("old-request-id", { text: "hello" }, () =>
        assert.fail("replayed"),
      ),
      { status: 409 },
    );
    const q = new MessageQueue(path.join(dir, "q.json"), {});
    q.add("a", "s", "sensitive text", "queued-id");
    q.items[0].state = "sent";
    q.items[0].finishedAt = 1;
    q.save();
    assert.ok(!fs.readFileSync(q.file, "utf8").includes("sensitive text"));
    const next = new MessageQueue(q.file, {});
    assert.deepEqual(next.add("a", "s", "sensitive text", "queued-id"), {
      accepted: true,
      queued: false,
    });
    assert.throws(() => next.add("b", "s", "sensitive text", "queued-id"), {
      status: 409,
    });
    assert.equal(next.items.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("launcher falls back to native binary when runtime or repository disappears", () => {
  const dir = fixture();
  try {
    const fallback = path.join(dir, "original backend"),
      launcher = path.join(dir, "launcher");
    fs.writeFileSync(fallback, '#!/bin/sh\nprintf "native:%s" "$1"\n', {
      mode: 0o700,
    });
    for (const node of [process.execPath, path.join(dir, "missing node")]) {
      fs.writeFileSync(
        launcher,
        renderDesktopLauncher(
          node,
          path.join(dir, "missing repo/proxy.mjs"),
          path.join(dir, "config.json"),
          fallback,
        ),
        { mode: 0o700 },
      );
      assert.equal(
        execFileSync(launcher, ["literal $(bad)"], { encoding: "utf8" }),
        "native:literal $(bad)",
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("default listeners exclude LAN and Cowork cannot read exported master keys", async () => {
  const interfaces = {
    en0: [{ family: "IPv4", address: "192.168.1.6" }],
    utun: [{ family: "IPv4", address: "100.100.1.2" }],
  };
  assert.deepEqual(listenAddresses(false, interfaces, ["100.100.1.2"]), [
    "127.0.0.1",
    "100.100.1.2",
  ]);
  assert.deepEqual(listenAddresses(true, interfaces), ["0.0.0.0"]);
  assert.deepEqual(listenAddresses(false, interfaces), ["127.0.0.1"]);
  const c = new ClaudeDesktopClient("/missing");
  await assert.rejects(c.connect(), /已暂停/);
  await c.close();
});
