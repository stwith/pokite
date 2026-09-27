import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ClaudeCloudCatalog,
  cloudProjectAlias,
} from "../server/claude-cloud-catalog.mjs";
const uuid = "00000000-0000-0000-0000-000000000001";
const cloud = (id, project) => ({
  id,
  environment_kind: "anthropic_cloud",
  tags: ["cowork-remote"],
  chat_project_id: project,
});
test("cloud project IDs match UUID metadata and unrelated malformed IDs are rejected", () => {
  assert.equal(
    cloudProjectAlias(uuid),
    "claude_proj_01" + "1".repeat(21) + "2",
  );
  assert.equal(cloudProjectAlias("../anything"), null);
});
test("cloud-only Chat/Cowork and folder-only associations appear with real project names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-cloud-"));
  const dir = path.join(root, "local-agent-mode-sessions/a/o");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "remote-session-spaces.json"),
    JSON.stringify({
      entries: [
        { sessionId: "session_folder", folders: ["/example/repo"] },
        { sessionId: "session_legacy", spaceId: "old-space" },
      ],
    }),
  );
  const rows = [
    cloud("cse_folder", cloudProjectAlias(uuid)),
    cloud("cse_legacy", cloudProjectAlias(uuid)),
    cloud("cse_chat", null),
    {
      id: "cse_code",
      environment_kind: "bridge",
      tags: ["product:claude-code"],
    },
  ];
  const catalog = new ClaudeCloudCatalog(root, {
    identity: async () => ({ account: "a", organization: "o" }),
    request: async (route) =>
      route.includes("projects_v2")
        ? {
            data: [{ uuid, name: "Real cloud name" }],
            pagination: { has_more: false },
          }
        : { data: rows },
  });
  try {
    const result = await catalog.get();
    assert.deepEqual(
      result.projects.map((p) => p.name),
      ["Real cloud name", "未分组"],
    );
    assert.equal(result.rows.length, 3);
    assert.equal(
      result.rows.find((r) => r.remoteId === "cse_folder").projectName,
      "Real cloud name",
    );
    assert.ok(
      result.projects[0].aliases.includes(
        "local-agent-mode-sessions:a:o:old-space",
      ),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("both catalogs paginate without reading transcripts; account changes discard results", async () => {
  let account = "a",
    changed = false;
  const calls = [];
  const client = {
    identity: async () => ({ account, organization: "o" }),
    request: async (route) => {
      calls.push(route);
      if (route.includes("projects_v2"))
        return route.includes("offset=0")
          ? { data: [{ uuid, name: "One" }], pagination: { has_more: true } }
          : { data: [], pagination: { has_more: false } };
      if (route.includes("cursor=")) {
        if (changed) account = "other";
        return { data: [cloud("cse_second", null)] };
      }
      return { data: [cloud("cse_first", null)], next_cursor: "page2" };
    },
  };
  const catalog = new ClaudeCloudCatalog("/missing", client);
  const result = await catalog.get();
  assert.equal(result.rows.length, 2);
  assert.equal(calls.length, 4);
  assert.equal(
    calls.some((r) => r.includes("/events")),
    false,
  );
  changed = true;
  await assert.rejects(catalog.get({ fresh: true }), { status: 409 });
});
test("malformed/repeated pagination fails explicitly instead of claiming a complete list", async () => {
  const catalog = new ClaudeCloudCatalog("/missing", {
    identity: async () => ({ account: "a", organization: "o" }),
    request: async (route) =>
      route.includes("projects_v2")
        ? { data: [], pagination: { has_more: false } }
        : { data: [], next_cursor: "same" },
  });
  await assert.rejects(catalog.get(), /分页未推进/);
});
test("project pagination honors a smaller server page size instead of skipping projects", async () => {
  const offsets = [];
  const catalog = new ClaudeCloudCatalog("/missing", {
    identity: async () => ({ account: "a", organization: "o" }),
    request: async (route) => {
      if (route.includes("/sessions?")) return { data: [] };
      const offset = Number(
        new URL("https://fixture.invalid" + route).searchParams.get("offset"),
      );
      offsets.push(offset);
      return {
        data: [
          {
            uuid: offset === 0 ? uuid : "00000000-0000-0000-0000-000000000002",
            name: String(offset),
          },
        ],
        pagination: { offset, limit: 30, has_more: offset === 0 },
      };
    },
  });
  assert.equal((await catalog.get()).projects.length, 2);
  assert.deepEqual(offsets, [0, 30]);
});
test("only same-account Desktop-owned bridges appear as Code projects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-code-bridge-"));
  try {
    const dir = path.join(root, "claude-code-sessions/a/o");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "local_owned.json"),
      JSON.stringify({
        sessionId: "local_owned",
        originCwd: "/workspace/repo",
        bridgeSessionIds: ["session_desktop"],
      }),
    );
    const other = path.join(root, "claude-code-sessions/other/o");
    await fs.mkdir(other, { recursive: true });
    await fs.writeFile(
      path.join(other, "local_other.json"),
      JSON.stringify({
        sessionId: "local_other",
        originCwd: "/workspace/other",
        bridgeSessionIds: ["session_foreign"],
      }),
    );
    const client = {
      identity: async () => ({ account: "a", organization: "o" }),
      request: async (route) =>
        route.includes("projects_v2")
          ? { data: [], pagination: { has_more: false } }
          : {
              data: [
                {
                  id: "cse_desktop",
                  environment_kind: "bridge",
                  status: "active",
                  connection_status: "connected",
                },
                { id: "cse_cli", environment_kind: "bridge", status: "active" },
                {
                  id: "cse_foreign",
                  environment_kind: "bridge",
                  status: "active",
                },
              ],
            },
    };
    const result = await new ClaudeCloudCatalog(root, client).get();
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].remoteId, "cse_desktop");
    assert.equal(result.projects[0].name, "Code · repo");
    assert.equal(result.projects[0].canCreate, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("partially written Desktop Code records do not hide cloud sessions or valid bridges", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-code-corrupt-"));
  try {
    const dir = path.join(root, "claude-code-sessions/a/o");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "local_broken.json"), '{"sessionId":');
    await fs.writeFile(path.join(dir, "local_null.json"), "null");
    await fs.writeFile(
      path.join(dir, "local_valid.json"),
      JSON.stringify({
        sessionId: "local_valid",
        originCwd: "/repo",
        bridgeSessionIds: ["cse_valid"],
      }),
    );
    const client = {
      identity: async () => ({ account: "a", organization: "o" }),
      request: async (route) =>
        route.includes("projects_v2")
          ? { data: [], pagination: { has_more: false } }
          : {
              data: [
                cloud("cse_cloud"),
                {
                  id: "cse_valid",
                  environment_kind: "bridge",
                  status: "active",
                },
              ],
            },
    };
    const result = await new ClaudeCloudCatalog(root, client).get();
    assert.deepEqual(result.rows.map((row) => row.remoteId).sort(), [
      "cse_cloud",
      "cse_valid",
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Desktop projects include unbridged local sessions without exposing them as Cowork", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pokite-local-project-"),
  );
  try {
    const dir = path.join(root, "claude-code-sessions/a/o");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "local_pokite.json"),
      JSON.stringify({
        sessionId: "local_pokite",
        cliSessionId: "11111111-1111-4111-8111-111111111111",
        originCwd: "/projects/pokite",
        title: "Local work",
        lastActivityAt: 1000,
      }),
    );
    const client = {
      identity: async () => ({ account: "a", organization: "o" }),
      request: async (route) =>
        route.includes("projects_v2")
          ? { data: [], pagination: { has_more: false } }
          : { data: [] },
    };
    const result = await new ClaudeCloudCatalog(root, client).get();
    assert.equal(result.projects[0].name, "Code · pokite");
    assert.equal(result.rows[0].codeLocalId, "local_pokite");
    assert.equal(result.rows[0].remoteId, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
