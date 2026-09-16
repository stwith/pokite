import test from "node:test";
import assert from "node:assert/strict";
import { parsePairingQR, acceptsPairingToken } from "../src/lib/pairing-qr.js";
test("pairing QR accepts credentials only in valid root HTTP(S) links", () => {
  const token="fixture-0123456789";
  assert.equal(parsePairingQR("http://host:3230/#token="+token,"http://host:3230").sameOrigin,true);
  assert.equal(parsePairingQR("http://other:3230/#token="+token,"http://host:3230").sameOrigin,false);
  for(const value of ["javascript:alert(1)","http://user:pass@host/#token="+token,"http://host/?token="+token,"http://host/path#token="+token,"http://host/#token=123456"])
    assert.throws(()=>parsePairingQR(value,"http://host"));
});
test("alternate network QR only connects here after local authentication", async () => {
  assert.equal(await acceptsPairingToken("fixture", async (url, options) => {
    assert.equal(url,"/api/agents");
    assert.equal(options.headers.Authorization,"Bearer fixture");
    return {ok:true,json:async()=>[]};
  }),true);
  assert.equal(await acceptsPairingToken("fixture",async()=>({ok:false})),false);
  assert.equal(await acceptsPairingToken("fixture",async()=>{throw Error("offline");}),false);
});
