import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { installHttpProtection } from "../server/http-middleware.mjs";
import { AccessThrottle, accessPeer } from "../server/access-throttle.mjs";
test("throttling has no global lock and forwarded identity is trusted only for verified Serve", () => {
  const t = new AccessThrottle();
  for (let i = 0; i < 200; i++) t.failed("peer-" + i);
  assert.equal(t.blocked("fresh"), false);
  const req = {
    socket: { remoteAddress: "192.168.1.9" },
    headers: { "x-forwarded-for": "100.1.1.1" },
  };
  assert.equal(accessPeer(req), "direct:192.168.1.9");
  req.pokiteServe = true;
  req.socket.remoteAddress = "127.0.0.1";
  assert.equal(accessPeer(req), "serve:100.1.1.1");
  req.headers["x-forwarded-for"] = "203.0.113.1, 100.1.1.2";
  assert.equal(accessPeer(req), "serve:100.1.1.2");
});
test("invalid remote tabs cannot block authenticated clients or localhost recovery", async () => {
  const app = express(),
    server = http.createServer(app);
  installHttpProtection(app, {
    token: "good",
    getPort: () => server.address().port,
  });
  app.get("/api/check", (_, res) => res.json({ ok: true }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/api/check`;
  const get = (token, remote = false) =>
    fetch(url, {
      headers: {
        Authorization: "Bearer " + token,
        ...(remote ? { "X-Forwarded-For": "100.64.1.2" } : {}),
      },
    });
  try {
    for (let i = 0; i < 10; i++)
      assert.equal((await get("old", true)).status, 401);
    assert.equal((await get("old", true)).status, 429);
    assert.equal((await get("good", true)).status, 200);
    for (let i = 0; i < 15; i++) assert.equal((await get("old")).status, 401);
    assert.equal((await get("good")).status, 200);
    assert.equal((await (await get("old")).json()).code, "ACCESS_REJECTED");
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
