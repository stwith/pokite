import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseClaudeModels,
  controlResult,
  settingEvents,
} from "../server/claude-models.mjs";
import { ClaudeDesktopRemote } from "../server/claude-desktop-remote.mjs";
import { Operations } from "../server/operations.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
const bootstrap = {
  model_selector_config: [
    {
      id: "cowork",
      models: [
        {
          id: "model-a",
          name: "Model A",
          thinking: {
            effort_options: [{ id: "low" }, { id: "high", recommended: true }],
          },
        },
        { id: "old", disabled: true, section: "deprecated" },
      ],
    },
  ],
  model_selector_state: [
    {
      id: "cowork",
      model: "model-a",
      thinking_by_model: [{ id: "model-a", thinking: { effort: "low" } }],
    },
  ],
};
test("model menus honor enabled models, allowed effort and actual session settings", () => {
  const c = parseClaudeModels(bootstrap, { model: "model-a", effort: "high" });
  assert.equal(c.options.length, 1);
  assert.equal(c.currentEffort, "high");
  assert.equal(c.options[0].defaultEffort, "low");
  assert.deepEqual(c.options[0].efforts, ["low", "high"]);
  assert.equal(c.canSwitch, true);
});
test("control acknowledgement must match both request IDs and reports explicit failure", () => {
  const body = settingEvents("cse_fixture", "request", "model-a", "high");
  const ids = body.events.map((e) => e.payload.request_id);
  const ack = (id) => ({
    payload: {
      type: "control_response",
      response: { request_id: id, subtype: "success" },
    },
  });
  assert.equal(controlResult([ack("foreign")], ids).complete, false);
  assert.equal(controlResult(ids.map(ack), ids).complete, true);
  assert.equal(
    controlResult(
      [
        {
          payload: {
            type: "control_response",
            response: {
              request_id: ids[0],
              subtype: "error",
              error: "model refused",
            },
          },
        },
      ],
      ids,
    ).error,
    "model refused",
  );
});
test("new session creation and its first message use one call, and lost responses never recreate automatically", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-create-"));
  let creates = 0;
  const p = {
    id: "project",
    uuid: "00000000-0000-0000-0000-000000000001",
    name: "Project",
    canCreate: true,
  };
  const a = new ClaudeDesktopRemote(dir, {
    client: {
      identity: async () => ({ account: "a", organization: "o" }),
      request: async (route, options) => {
        assert.match(route, /cowork\/sessions$/);
        assert.equal(options.body.message, "hello");
        creates++;
        throw Object.assign(Error("response lost"), { delivery: "unknown" });
      },
      close: async () => {},
    },
  });
  a.catalog.get = async () => ({ scope: "a:o", projects: [p] });
  a.modelSettings.get = async () => parseClaudeModels(bootstrap);
  const operations = new Operations(path.join(dir, "ops.json"));
  try {
    await assert.rejects(
      operations.run("create-request-123", { text: "hello" }, () =>
        a.createAndSend(p, "hello", "create-request-123"),
      ),
      { delivery: "unknown" },
    );
    await assert.rejects(
      operations.run("create-request-123", { text: "hello" }, () =>
        a.createAndSend(p, "hello", "create-request-123"),
      ),
      { status: 409 },
    );
    assert.equal(creates, 1);
  } finally {
    await a.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("model rejection blocks an unsent message and allows withdrawal instead of retrying forever", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-blocked-"));
  let sends = 0;
  const q = new MessageQueue(path.join(dir, "queue.json"), {
    cloud: {
      detail: async () => ({ status: "idle", messages: [] }),
      send: async () => {
        sends++;
        throw Object.assign(Error("Model change rejected"), {
          delivery: "not-sent",
          blocked: true,
        });
      },
    },
  });
  try {
    q.add("cloud", "session", "hello", "blocked-request-123");
    await q.tick();
    await q.tick();
    assert.equal(sends, 1);
    assert.equal(q.items[0].state, "blocked");
    assert.equal(q.items[0].error, "Model change rejected");
    assert.equal(
      q.withdraw("cloud", "session", "blocked-request-123").text,
      "hello",
    );
  } finally {
    await q.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("switching models reapplies the chosen effort even if the previous model used the same level", async () => {
  let posted;
  const a = new ClaudeDesktopRemote("/missing", {
    client: {
      close: async () => {},
      request: async (route, options) => {
        if (options.method === "POST") {
          posted = options.body;
          return {};
        }
        return {
          data: posted.events.map((e) => ({
            payload: {
              type: "control_response",
              response: {
                subtype: "success",
                request_id: e.payload.request_id,
              },
            },
          })),
        };
      },
    },
  });
  try {
    await a.applySettings(
      { remoteId: "cse_fixture", scope: "a:o", model: "old", effort: "high" },
      { id: "new", defaultEffort: "high" },
      "request",
    );
    assert.equal(posted.events.length, 2);
    assert.equal(posted.events[1].payload.request.settings.effortLevel, "high");
  } finally {
    await a.close();
  }
});

test("Desktop Code selects only its own model surface, never Cowork models", () => {
  const value = {
    ...bootstrap,
    model_selector_config: [
      ...bootstrap.model_selector_config,
      {
        id: "ccd",
        models: [
          {
            id: "code-model",
            name: "Code model",
            thinking: { effort_options: [{ id: "medium", recommended: true }] },
          },
        ],
      },
    ],
  };
  const code = parseClaudeModels(value, {}, "code");
  assert.deepEqual(
    code.options.map((m) => m.id),
    ["code-model"],
  );
  assert.equal(code.currentEffort, "medium");
  assert.deepEqual(
    parseClaudeModels(value).options.map((m) => m.id),
    ["model-a"],
  );
  assert.throws(
    () => parseClaudeModels(bootstrap, {}, "code"),
    /模型列表不可用/,
  );
});

test("Desktop adapters isolate project lists, direct session access and creation capability", async () => {
  const cloud = {
    id: "cloud",
    projectId: "cloud:project",
    remoteId: "cse_cloud",
    native: { id: "cse_cloud", status: "active" },
  };
  const code = {
    id: "code",
    projectId: "desktop-code:project",
    remoteId: "cse_code",
    codeLocalId: "local_one",
    native: {
      id: "cse_code",
      status: "active",
      environment_kind: "bridge",
      connection_status: "connected",
    },
  };
  const snapshot = {
    time: Date.now(),
    rows: [cloud, code],
    projects: [
      { id: cloud.projectId, name: "Cloud", aliases: [], canCreate: true },
      {
        id: code.projectId,
        name: "Code · Repo",
        aliases: [],
        canCreate: false,
      },
    ],
  };
  const client = {
    close: async () => {},
    request: async () => {
      throw Error("unexpected request");
    },
  };
  const cowork = new ClaudeDesktopRemote("/tmp/fixture", { client });
  const desktopCode = new ClaudeDesktopRemote("/tmp/fixture", {
    client,
    surface: "code",
  });
  cowork.catalog.get = desktopCode.catalog.get = async () => snapshot;
  assert.deepEqual(
    (await cowork.projects()).map((p) => p.id),
    [cloud.projectId],
  );
  assert.deepEqual(
    (await desktopCode.projects()).map((p) => p.name),
    ["Repo"],
  );
  assert.deepEqual(
    (await cowork.raw()).map((s) => s.id),
    ["cloud"],
  );
  assert.deepEqual(
    (await desktopCode.raw()).map((s) => s.id),
    ["code"],
  );
  assert.deepEqual(await cowork.raw({ id: "code" }), []);
  assert.deepEqual(await desktopCode.raw({ id: "cloud" }), []);
  assert.equal(desktopCode.createAndSend, undefined);
  assert.equal(typeof cowork.createAndSend, "function");
  await cowork.close();
  await desktopCode.close();
});

test("waiting Desktop Code sessions tell mobile users where to approve", async () => {
  const adapter = new ClaudeDesktopRemote("/tmp/fixture", {
    surface: "code",
    client: { close: async () => {} },
  });
  adapter.raw = async () => [
    { id: "code", codeLocalId: "local_code", status: "waiting" },
  ];
  adapter.page = async () => ({ messages: [] });
  try {
    const detail = await adapter.detail("code");
    assert.equal(detail.approvalNotice, "请在 Claude Desktop 中处理审批");
    assert.equal(detail.executionIssue, null);
  } finally {
    await adapter.close();
  }
});
