import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { WebSocketServer } from "ws";
import { Dsh } from "../server/dsh.mjs";
import { DshAuth } from "../server/dsh-auth.mjs";
import { loadInstances } from "../server/instances.mjs";
import { AgentConnections } from "../server/agent-connections.mjs";

// Mirrors dsh 0.2 web: a launch token on GET /?token= mints a signed cookie
// (303); every API and WebSocket request without that cookie gets 401.
async function fakeDsh({ token = "launch-token-123" } = {}) {
  const cookie = "dsh-auth-x=v1.signed";
  const seen = { apiCookies: [], wsCookies: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/") {
      if (url.searchParams.get("token") === token) {
        res.writeHead(303, {
          location: "./",
          "set-cookie": `${cookie}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict`,
        });
        return res.end();
      }
      if (req.headers.cookie === cookie) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<!doctype html>");
      }
      res.writeHead(401);
      return res.end("unauthorized");
    }
    seen.apiCookies.push(req.headers.cookie);
    if (req.headers.cookie !== cookie) {
      res.writeHead(401);
      return res.end("unauthorized");
    }
    // Auth is exercised over the dotted workspace.list route only.
    if (req.url !== "/api/workspace.list") {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        result: {
          ok: true,
          value: { items: [{ workspaceId: "w", path: "/p", sessionIds: [] }] },
        },
      }),
    );
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    seen.wsCookies.push(req.headers.cookie);
    if (req.headers.cookie !== cookie) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => ws.close());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    token,
    seen,
    close: () => {
      wss.close();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pokite-dsh-auth-"));
}

test("an unpaired 0.2 server reports that pairing is required, not a bare HTTP 401", async () => {
  const server = await fakeDsh();
  const dir = temp();
  try {
    const dsh = new Dsh(server.base, { authFile: path.join(dir, "auth.json") });
    dsh.connect = () => {};
    await assert.rejects(dsh.projects(), (e) => {
      assert.match(e.message, /需要配对/);
      assert.equal(e.code, "DSH_PAIRING_REQUIRED");
      assert.notEqual(e.status, 401); // 401 is reserved for Pokite's own access code
      return true;
    });
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pairing from the launch log mints a cookie that later processes reuse", async () => {
  const server = await fakeDsh();
  const dir = temp();
  try {
    const authFile = path.join(dir, "auth.json");
    const launchLog = path.join(dir, "dsh-web.log");
    fs.writeFileSync(
      launchLog,
      "npm warn noise\n" +
        "dsh web: http://127.0.0.1:1/?token=other-server\n" +
        `dsh web: ${server.base}/?token=stale\n` +
        `dsh web: ${server.base}/?token=${server.token}\n`,
    );
    const first = new Dsh(server.base, { authFile, launchLog });
    first.connect = () => {};
    assert.equal((await first.projects())[0].id, "w");
    assert.equal(fs.statSync(authFile).mode & 0o777, 0o600);
    assert.equal(
      JSON.stringify(fs.readFileSync(authFile, "utf8")).includes(server.token),
      false,
    );
    // A new process pairs nothing: it reuses the stored cookie without the log.
    const second = new Dsh(server.base, { authFile });
    second.connect = () => {};
    assert.equal((await second.projects()).length, 1);
    assert.equal(server.seen.apiCookies.at(-1), "dsh-auth-x=v1.signed");
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit pairing validates the URL's origin and token", async () => {
  const server = await fakeDsh();
  const dir = temp();
  try {
    const auth = new DshAuth(server.base, {
      file: path.join(dir, "auth.json"),
    });
    await assert.rejects(
      auth.pair("http://127.0.0.1:1/?token=x"),
      /不是这个 DeepSeek Harness/,
    );
    await assert.rejects(auth.pair(server.base + "/"), /缺少 token/);
    await assert.rejects(auth.pair(server.base + "/?token=wrong"), /令牌无效/);
    await auth.pair(`${server.base}/?token=${server.token}`);
    assert.equal(auth.cookie(), "dsh-auth-x=v1.signed");
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("expired or rejected cookies are dropped so pairing is requested again", async () => {
  const server = await fakeDsh();
  const dir = temp();
  try {
    const authFile = path.join(dir, "auth.json");
    const origin = new URL(server.base).origin;
    fs.writeFileSync(
      authFile,
      JSON.stringify({
        [origin]: { cookie: "dsh-auth-x=v1.signed", expiresAt: Date.now() - 1 },
      }),
    );
    assert.equal(new DshAuth(server.base, { file: authFile }).cookie(), null);
    fs.writeFileSync(
      authFile,
      JSON.stringify({
        [origin]: { cookie: "dsh-auth-x=revoked", expiresAt: Date.now() + 1e6 },
      }),
    );
    const dsh = new Dsh(server.base, { authFile });
    dsh.connect = () => {};
    await assert.rejects(dsh.projects(), { code: "DSH_PAIRING_REQUIRED" });
    assert.equal(new DshAuth(server.base, { file: authFile }).cookie(), null);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the event WebSocket carries the paired cookie", async () => {
  const server = await fakeDsh();
  const dir = temp();
  try {
    const auth = new DshAuth(server.base, {
      file: path.join(dir, "auth.json"),
    });
    await auth.pair(`${server.base}/?token=${server.token}`);
    const dsh = new Dsh(server.base, { authFile: path.join(dir, "auth.json") });
    dsh.connect();
    await new Promise((resolve) => dsh.socket.once("close", resolve));
    assert.equal(server.seen.wsCookies.at(-1), "dsh-auth-x=v1.signed");
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("instance launchLog is validated and expands ~", () => {
  const dir = temp();
  try {
    const file = path.join(dir, "instances.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        instances: [
          {
            id: "dsh",
            provider: "dsh",
            name: "DSH",
            launchLog: "~/Library/Logs/dsh-web/dsh-web.log",
          },
        ],
      }),
    );
    assert.equal(
      loadInstances(file)[0].launchLog,
      path.join(os.homedir(), "Library/Logs/dsh-web/dsh-web.log"),
    );
    fs.writeFileSync(
      file,
      JSON.stringify({
        instances: [
          {
            id: "dsh",
            provider: "dsh",
            name: "DSH",
            launchLog: "relative.log",
          },
        ],
      }),
    );
    assert.throws(() => loadInstances(file), /launchLog/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the connection check authenticates like the adapter and names pairing", async () => {
  const server = await fakeDsh();
  const dir = temp();
  try {
    const authFile = path.join(dir, "auth.json");
    const instance = { id: "dsh", provider: "dsh", url: server.base };
    const adapter = new Dsh(server.base, { authFile });
    const check = () =>
      new AgentConnections({ dsh: adapter }).inspect(instance);
    const before = await check();
    assert.equal(before.connected, false);
    assert.match(before.notice, /配对/);
    await new DshAuth(server.base, { file: authFile }).pair(
      `${server.base}/?token=${server.token}`,
    );
    assert.deepEqual(await check(), { connected: true });
    await server.close();
    assert.equal((await check()).connected, false);
  } finally {
    await server.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
