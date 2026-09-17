import express from "express";
import fs from "node:fs/promises";
import { presentSession } from "./read-state.mjs";
import { ReadCoordinator } from "./read-coordinator.mjs";
import { SessionEvents } from "./session-events.mjs";
import {
  installHttpProtection,
  installResponseHandling,
} from "./http-middleware.mjs";
import { serveEventStream } from "./event-stream.mjs";
import { selectModelSettings } from "./model-settings.mjs";
import { installWriteLifecycle } from "./write-lifecycle.mjs";
import { networkLinks, tailscaleHttpsLink } from "./network-links.mjs";
import { capabilities } from "./instances.mjs";

// Runtime resources are injected; importing routes never starts agents or listeners.
export function createApp({
  adapters,
  agentNames,
  token,
  messages,
  operations,
  reads,
  saveReads,
  dist,
  getPort,
  push,
  events = new SessionEvents(adapters),
}) {
  const locks = new Map();
  const readCoordinator = new ReadCoordinator();
  const read = (req, method, ...args) =>
    readCoordinator.run([req.params.agent, method, ...args], () =>
      req.adapter[method](...args),
    );
  const app = express();
  app.locals.events = events;
  app.disable("x-powered-by");
  const post = installWriteLifecycle(app);
  installHttpProtection(app, { token, getPort });
  app.use(express.json({ limit: "128kb" }));
  app.param("agent", (req, res, next, id) => {
    if (!Object.hasOwn(adapters, id))
      return res.status(404).json({ error: "Unknown agent" });
    req.adapter = adapters[id];
    next();
  });
  installResponseHandling(app, events);
  if (push) {
    app.get("/api/notifications/config", (req, res) => res.json(push.config()));
    post("/api/notifications/status", (req, res) => res.json(push.status(req.body.endpoint)));
    post("/api/notifications/subscribe", async (req, res) => {
      res.json(await push.subscribe(req.body.subscription, req.pokiteOrigin, req.body.agent, req.body.projectId));
    });
    post("/api/notifications/remove", (req, res) => res.json(push.remove(req.body.endpoint, req.body.project)));
    post("/api/notifications/test", async (req, res) => res.json(await push.test(req.body.endpoint)));
  }
  app.get("/api/:agent/events", (req, res) =>
    serveEventStream(req, res, events),
  );
  const key = (a, id) => a + ":" + id;
  const annotate = (a, s) => presentSession(reads, a, s);
  function remember(a, rows, projectId) {
    if (!reads["initialized:v2:" + a + ":" + projectId]) {
      for (const s of rows)
        if (typeof s.nativeUnread !== "boolean")
          reads[key(a, s.id)] = s.revision;
      reads["initialized:v2:" + a + ":" + projectId] = true;
      saveReads();
    }
  }
  async function project(adapter, id) {
    const found = (await adapter.projects()).find((p) => p.id === id);
    if (!found)
      throw Object.assign(Error("只能选择此 Agent 的已有项目"), {
        status: 404,
      });
    if (
      (adapter.readOnly && found.readOnly) ||
      (adapter.supportsVirtualProjects && found.virtual)
    )
      return found;
    const st = await fs.stat(found.path).catch(() => null);
    if (!st?.isDirectory())
      throw Object.assign(Error("项目目录已不存在"), { status: 409 });
    return found;
  }
  async function mutate(req, fn) {
    return operations.run(
      req.body.requestId,
      { path: req.path, body: req.body },
      fn,
    );
  }
  const validText = (t) => {
    if (typeof t !== "string" || !t.trim() || t.length > 50000)
      throw Object.assign(Error("消息为空或过长"), { status: 400 });
    return t.trim();
  };
  app.get("/api/agents", (req, res) =>
    res.json(
      Object.entries(agentNames).map(([id, name]) => ({
        id,
        name,
        capabilities: capabilities(adapters[id]),
        emptyState: adapters[id].emptyState,
      })),
    ),
  );
  app.get("/api/connection-links", async (req, res) =>
    res.json(
      { ...networkLinks(
        getPort(),
        undefined,
        req.socket.localAddress?.replace(/^::ffff:/, ""),
      ), tailscaleHttps: await tailscaleHttpsLink(getPort()) },
    ),
  );
  app.get("/api/:agent/projects", async (req, res) =>
    res.json(await read(req, "projects")),
  );
  post("/api/:agent/connect", async (req, res) => {
    if (!req.adapter.connect)
      return res.status(400).json({ error: "此 Agent 无需单独连接" });
    res.json(await req.adapter.connect());
  });
  app.get("/api/:agent/models", async (req, res) => {
    const p = await project(req.adapter, req.query.projectId);
    const sid = req.query.sessionId;
    if (sid) {
      const s = await read(req, "detail", sid);
      if (s.projectId !== p.id)
        throw Object.assign(Error("Session does not belong to project"), {
          status: 400,
        });
    }
    res.json(await read(req, "models", p, sid));
  });
  app.get("/api/:agent/sessions", async (req, res) => {
    await project(req.adapter, req.query.projectId);
    const allRows = await read(req, "sessions", req.query.projectId, {
      limit: Math.min(10000, Math.max(40, Number(req.query.limit) || 40)),
    });
    const search =
      typeof req.query.search === "string"
        ? req.query.search.slice(0, 500).toLowerCase()
        : "";
    const rows = search
      ? allRows.filter((s) => s.title.toLowerCase().includes(search))
      : allRows;
    remember(req.params.agent, allRows, req.query.projectId);
    const annotated = rows.map((s) => annotate(req.params.agent, s));
    if (req.query.limit) {
      const limit = Number(req.query.limit),
        offset = Number(req.query.cursor || 0);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 10000 ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        throw Object.assign(Error("Invalid pagination"), { status: 400 });
      return res.json({
        items: annotated.slice(offset, offset + limit),
        nextCursor:
          offset + limit < rows.length ? String(offset + limit) : null,
        total: rows.length,
      });
    }
    res.json(annotated);
  });
  app.get("/api/:agent/sessions/:id", async (req, res) => {
    const s = await read(req, "detail", req.params.id);
    messages.reconcile(req.params.agent, req.params.id, s);
    res.json({
      ...annotate(req.params.agent, s),
      queue: [
        ...new Map(
          [
            ...(s.nativeQueue || []),
            ...messages.list(req.params.agent, s.id),
          ].map((q) => [q.requestId, q]),
        ).values(),
      ],
    });
  });
  app.get("/api/:agent/sessions/:id/history", async (req, res) => {
    if (typeof req.query.before !== "string" || req.query.before.length > 200)
      throw Object.assign(Error("Invalid cursor"), { status: 400 });
    res.json(await read(req, "history", req.params.id, req.query.before));
  });
  post("/api/:agent/sessions/:id/read", async (req, res) => {
    const s = await req.adapter.detail(req.params.id);
    const acknowledged = req.body.revision === s.revision;
    if (acknowledged) {
      reads[key(req.params.agent, s.id)] = s.revision;
      saveReads();
    }
    res.json({ ok: acknowledged });
  });
  post("/api/:agent/sessions", async (req, res) => {
    const text = validText(req.body.text);
    if (req.adapter.readOnly)
      throw Object.assign(Error("Codex 桌面写入保护中，暂时仅查看会话"), {
        status: 409,
      });
    const p = await project(req.adapter, req.body.projectId);
    if (p.canCreate === false)
      throw Object.assign(Error("请先选择已有项目"), { status: 400 });
    const model = await selectModelSettings(req.adapter, p, null, req.body);
    const result = await mutate(req, async () => {
      const s = await req.adapter.create(p, model);
      try {
        await req.adapter.send(s.id, text, req.body.requestId, model);
        return s;
      } catch (e) {
        return { ...s, error: "会话已创建，消息未确认送达：" + e.message };
      }
    });
    res.json(result);
  });
  post("/api/:agent/sessions/:id/messages", async (req, res) => {
    const text = validText(req.body.text);
    if (req.adapter.readOnly)
      throw Object.assign(Error("Codex 桌面写入保护中，暂时仅查看会话"), {
        status: 409,
      });
    const id = req.params.id;
    res.json(
      await mutate(req, async () => {
        const lock = key(req.params.agent, id);
        const previous = locks.get(lock);
        let unlock;
        const held = new Promise((resolve) => {
          unlock = resolve;
        });
        locks.set(lock, held);
        await previous;
        try {
          const s = await req.adapter.detail(id);
          if (s.readOnly)
            throw Object.assign(Error(s.readOnlyReason || "此会话只读"), {
              status: 409,
            });
          const p = await project(req.adapter, s.projectId);
          const model = await selectModelSettings(req.adapter, p, id, req.body);
          return messages.add(
            req.params.agent,
            id,
            text,
            req.body.requestId,
            model,
          );
        } finally {
          unlock();
          if (locks.get(lock) === held) locks.delete(lock);
        }
      }),
    );
  });
  post("/api/:agent/sessions/:id/answers/:aid", async (req, res) => {
    if (!req.adapter.answer)
      return res.status(400).json({ error: "请在原 Agent 界面处理审批" });
    res.json(await req.adapter.answer(req.params.id, req.params.aid, req.body));
  });
  post("/api/:agent/sessions/:id/queue/:qid/withdraw", (req, res) => {
    res.json(
      messages.withdraw(req.params.agent, req.params.id, req.params.qid),
    );
  });
  post("/api/:agent/sessions/:id/queue/:qid/remove", (req, res) => {
    messages.remove(req.params.agent, req.params.id, req.params.qid);
    res.json({ ok: true });
  });
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
  app.use(express.static(dist));
  app.use((err, req, res, next) => {
    console.error(req.path, err.message);
    res
      .status(err.status || 502)
      .json({ error: err.message || "Agent unavailable" });
  });

  return app;
}
