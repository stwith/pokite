import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { WebSocketServer } from "ws";
import { Dsh } from "../server/dsh.mjs";

const W = "ws-1";
const S = "session-a";
const event = (seq, type, data) => ({
  type: "event",
  event: { seq, type, time: 1790000000000 + seq, data },
});
const records = [
  event(1, "turn/start", { turn: 1 }),
  event(2, "user/message", {
    content: [{ type: "text", text: "你好" }],
    source: { kind: "user" },
    role: "user",
  }),
  event(3, "assistant/message", {
    turn: 1,
    message: { role: "assistant", content: [{ type: "text", text: "在的" }] },
  }),
  event(4, "turn/end", { turn: 1, reason: { kind: "completed" } }),
];

// Mirrors the dsh 0.2 web wire protocol verified against 0.2.0-rc.2:
// POST /api/<ns>/<method> with payload.args, and every stream multiplexed
// over the /api/remote.mux WebSocket as {type:"item",streamId,value}.
async function fakeDsh2() {
  const calls = [];
  const streams = [];
  const rpc = {
    "session/list": () => ({
      items: [
        {
          sessionId: S,
          updatedAt: 5,
          running: false,
          blank: false,
          // Projection-cache seq, not an event cursor (real servers differ).
          projections: { asOfSeq: 250, values: { title: "测试会话" } },
        },
        {
          sessionId: "session-child",
          parentSessionId: S,
          updatedAt: 5,
          running: false,
          blank: false,
        },
        {
          sessionId: "session-archived",
          updatedAt: 1,
          running: false,
          blank: false,
        },
      ],
    }),
    "session/page": ({ request }) => {
      if (request.throughSeq > 4)
        throw Object.assign(
          Error(
            `session page through seq ${request.throughSeq} is past cursor 4`,
          ),
          { code: "gateway/bad-request" },
        );
      // Newest page: the last turn's reply; older pages: everything before.
      return request.beforeSeq === undefined
        ? { records: records.slice(2), hasMore: true }
        : {
            records: records.filter((r) => r.event.seq < request.beforeSeq),
            hasMore: false,
          };
    },
    "session/modelCatalog": () => ({
      default: { provider: "deepseek-official", model: "deepseek-flash" },
      routableProviders: ["deepseek-official"],
      groups: [
        {
          id: "deepseek-official",
          name: "DeepSeek",
          models: [
            { id: "deepseek-flash", name: "Flash" },
            {
              id: "deepseek-v4-pro",
              name: "V4 Pro",
              reasoning: { efforts: [{ id: "high", name: "High" }] },
            },
          ],
        },
      ],
      failures: [],
    }),
    "session/projections": () => ({
      asOfSeq: 4,
      values: {
        modelSelection: {
          lastUsed: null,
          next: {
            provider: "deepseek-official",
            model: "deepseek-v4-pro",
            reasoningEffort: "high",
          },
        },
      },
    }),
    "session/create": ({ request }) => ({
      sessionId: "session-new-" + request.workspaceId,
    }),
    "session/selectModel": ({ request }) => ({ selected: request }),
    "session/prompt": ({ request }) => {
      if (request.sessionId === "session-held")
        throw Object.assign(
          Error(
            `session "session-held" is already owned by an active write handle`,
          ),
          { code: "session/writer-held" },
        );
      return { accepted: true };
    },
  };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const method = req.url.replace(/^\/api\//, "");
    if (req.method !== "POST" || !rpc[method]) {
      res.writeHead(404);
      return res.end("not found");
    }
    const message = JSON.parse(body);
    assert.equal(message.method, method);
    assert.deepEqual(Object.keys(message.payload), ["args"]);
    calls.push({ method, args: message.payload.args });
    let result;
    try {
      result = { ok: true, value: rpc[method](message.payload.args) };
    } catch (e) {
      result = { ok: false, error: { code: e.code, message: e.message } };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ type: "server-response", rpcId: message.rpcId, result }),
    );
  });
  const wss = new WebSocketServer({ server, path: "/api/remote.mux" });
  wss.on("connection", (ws) =>
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type !== "open") return;
      streams.push({ endpoint: m.endpoint, args: m.payload.args });
      const send = (value) =>
        ws.send(JSON.stringify({ type: "item", streamId: m.streamId, value }));
      if (m.endpoint === "workspace/follow")
        send({
          type: "baseline",
          value: {
            items: [
              {
                workspaceId: W,
                path: "/Users/x/proj",
                title: "proj",
                sessionIds: [S, "session-child", "session-archived"],
              },
            ],
            archivedSessionIds: ["session-archived"],
            pinnedSessionIds: [],
          },
        });
      if (m.endpoint === "session/follow")
        send({
          type: "snapshot",
          header: { version: 4, id: S, createdAt: 1, isSeeded: false },
          cursor: 4,
          records: records.slice(2),
          hasMore: true,
          projections: { asOfSeq: 4, values: { title: "测试会话" } },
        });
      if (m.endpoint === "session/control")
        send({ type: "baseline", value: { projections: {} } });
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    calls,
    streams,
    close: () => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
async function withDsh(run) {
  const server = await fakeDsh2();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-dsh2-"));
  const dsh = new Dsh(server.base, { authFile: path.join(dir, "auth.json") });
  try {
    await run(dsh, server);
  } finally {
    dsh.close();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("0.2: projects come from the workspace/follow baseline without archived sessions", () =>
  withDsh(async (dsh) => {
    assert.deepEqual(await dsh.projects(), [
      {
        id: W,
        path: "/Users/x/proj",
        name: "proj",
        sessionIds: [S, "session-child"],
      },
    ]);
  }));

test("0.2: sessions list top-level sessions of the project", () =>
  withDsh(async (dsh, server) => {
    const rows = await dsh.sessions(W);
    assert.deepEqual(
      rows.map((r) => [r.id, r.title]),
      [[S, "测试会话"]],
    );
    assert.deepEqual(
      server.calls.find((c) => c.method === "session/list").args,
      {
        _request: {},
      },
    );
  }));

test("0.2: detail reads without activating the session (no follow stream)", () =>
  withDsh(async (dsh, server) => {
    const d = await dsh.detail(S);
    assert.deepEqual(
      d.messages.map((m) => [m.role, m.text]),
      [["assistant", "在的"]],
    );
    assert.equal(d.status, "completed");
    assert.equal(d.hasMore, true);
    assert.equal(d.historyCursor, 3);
    // session/follow activates the session and takes its write lock, which
    // would block the Desktop app from continuing it.
    assert.equal(
      server.streams.some((s) => s.endpoint === "session/follow"),
      false,
    );
    const page = server.calls.find((c) => c.method === "session/page").args
      .request;
    assert.deepEqual(page, {
      address: { kind: "session", sessionId: S },
      throughSeq: 4,
      maxMessages: 30,
    });
  }));

test("0.2: history pages backwards through session/page", () =>
  withDsh(async (dsh, server) => {
    const h = await dsh.history(S, "3");
    assert.deepEqual(
      h.messages.map((m) => m.text),
      ["你好"],
    );
    assert.equal(h.hasMore, false);
    const page = server.calls.find(
      (c) =>
        c.method === "session/page" && c.args.request.beforeSeq !== undefined,
    ).args.request;
    assert.equal(page.beforeSeq, 3);
    assert.equal(page.throughSeq, 4);
  }));

test("0.2: models merge the catalog with the session's next selection", () =>
  withDsh(async (dsh) => {
    const m = await dsh.models({ id: W }, S);
    assert.deepEqual(
      m.options.map((o) => o.model),
      ["deepseek-flash", "deepseek-v4-pro"],
    );
    assert.equal(
      m.current,
      JSON.stringify(["deepseek-official", "deepseek-v4-pro"]),
    );
    assert.equal(m.currentEffort, "high");
    const fresh = await dsh.models({ id: W });
    assert.equal(
      fresh.current,
      JSON.stringify(["deepseek-official", "deepseek-flash"]),
    );
  }));

test("0.2: send selects the model, then prompts with a stable UUID request id", () =>
  withDsh(async (dsh, server) => {
    const model = {
      provider: "deepseek-official",
      model: "deepseek-v4-pro",
      effort: "high",
    };
    await dsh.send(S, "继续", "client-req-1", model);
    // A restarted Pokite has no local record; dsh sees the same UUID again.
    const restarted = new Dsh(server.base, { authFile: dsh.auth.file });
    try {
      await restarted.send(S, "继续", "client-req-1");
    } finally {
      restarted.close();
    }
    const select = server.calls.find((c) => c.method === "session/selectModel")
      .args.request;
    assert.deepEqual(select, {
      sessionId: S,
      provider: "deepseek-official",
      model: "deepseek-v4-pro",
      reasoningEffort: "high",
    });
    const prompts = server.calls.filter((c) => c.method === "session/prompt");
    const first = prompts[0].args.request;
    assert.match(
      first.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    assert.equal(prompts[1].args.request.requestId, first.requestId);
    assert.deepEqual(
      { ...first, requestId: undefined },
      {
        requestId: undefined,
        sessionId: S,
        mode: "queue",
        content: [{ type: "text", text: "继续" }],
        clientTimeZone: "Asia/Shanghai",
      },
    );
  }));

test("0.2: create opens a session in the workspace", () =>
  withDsh(async (dsh, server) => {
    assert.deepEqual(await dsh.create({ id: W }), { id: "session-new-" + W });
    assert.deepEqual(
      server.calls.find((c) => c.method === "session/create").args,
      {
        request: { workspaceId: W },
      },
    );
  }));

test("a 0.1 server keeps using the dotted protocol", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    if (req.url === "/api/workspace.list") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          result: {
            ok: true,
            value: {
              items: [
                { workspaceId: W, path: "/p", title: "p", sessionIds: [] },
              ],
            },
          },
        }),
      );
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-dsh1-"));
  const dsh = new Dsh(`http://127.0.0.1:${server.address().port}`, {
    authFile: path.join(dir, "auth.json"),
  });
  dsh.connect = () => {};
  try {
    assert.equal((await dsh.projects())[0].id, W);
    assert.ok(seen.includes("/api/workspace.list"));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("0.2: list status summaries read the session tail without a projection-cache cursor", () =>
  withDsh(async (dsh, server) => {
    await dsh.sessions(W);
    for (let i = 0; i < 50 && dsh.summariesLoading; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await dsh.sessions(W))[0].status, "completed");
    assert.equal(
      server.calls.some(
        (c) => c.method === "session/page" && c.args.request.throughSeq === 250,
      ),
      false,
    );
  }));

test("0.2: sending to a session held by another dsh process explains where to continue", () =>
  withDsh(async (dsh) => {
    await assert.rejects(dsh.send("session-held", "hi", "r1"), (e) => {
      assert.match(e.message, /桌面版/);
      assert.equal(e.status, 409);
      return true;
    });
  }));

test("0.2: a retried send with an accepted request id is not re-submitted", () =>
  withDsh(async (dsh, server) => {
    await dsh.send(S, "一次", "req-dup");
    await dsh.send(S, "一次", "req-dup");
    await dsh.send(S, "另一条", "req-other");
    // dsh 0.2 can re-insert a prompt retried while its first copy is claimed
    // but not yet journaled, so accepted ids are also remembered locally.
    assert.equal(
      server.calls.filter((c) => c.method === "session/prompt").length,
      2,
    );
  }));
