import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createApp } from "../server/app.mjs";
import { ClaudeDesktop } from "../server/claude-desktop.mjs";

test("Desktop spaces expose real project names without inventing remote transcripts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-spaces-"));
  try {
    const dir = path.join(root, "local-agent-mode-sessions/account/org");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(root, "config.json"),
      JSON.stringify({ lastKnownAccountUuid: "account" }),
    );
    await fs.writeFile(
      path.join(dir, "spaces.json"),
      JSON.stringify({
        spaces: [
          {
            id: "space",
            name: "Real project",
            folders: [{ path: "/work/project" }],
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(dir, "remote-session-spaces.json"),
      JSON.stringify({
        entries: [{ spaceId: "space", sessionId: "remote-session" }],
      }),
    );
    const a = new ClaudeDesktop(root);
    const projects = await a.projects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "Real project");
    assert.equal(projects[0].path, "/work/project");
    assert.match(projects[0].emptyState, /远程/);
    assert.deepEqual(await a.sessions(projects[0].id), []);
    await fs.writeFile(
      path.join(dir, "local_task.json"),
      JSON.stringify({ sessionId: "local_task", spaceId: "space" }),
    );
    a.cache = null;
    assert.equal((await a.projects()).length, 1);
    assert.equal(
      (await a.sessions(projects[0].id))[0].projectName,
      "Real project",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Desktop account switching excludes old sessions and groups actual workspaces", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-scope-"));
  const login = (account) =>
    fs.writeFile(
      path.join(root, "config.json"),
      JSON.stringify({ lastKnownAccountUuid: account }),
    );
  async function add(account, org, kind, id, fields = {}) {
    const dir = path.join(root, kind, account, org);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, id + ".json"),
      JSON.stringify({ sessionId: id, title: id, ...fields }),
    );
  }
  try {
    await add("old", "org", "claude-code-sessions", "local_old", {
      originCwd: "/work/old",
    });
    await add("current", "org", "claude-code-sessions", "local_a", {
      originCwd: "/work/repo",
      cwd: "/work/worktree",
    });
    await add("current", "org", "claude-code-sessions", "local_b", {
      originCwd: "/work/repo",
    });
    await add("current", "org", "claude-code-sessions", "local_c", {
      originCwd: "/work/other",
    });
    await add("current", "org", "local-agent-mode-sessions", "local_cowork", {
      spaceId: "space-1",
      cwd: "/sessions/internal/outputs",
    });
    const a = new ClaudeDesktop(root);
    await assert.rejects(a.projects(), /无法确认/);
    await login("old");
    assert.equal((await a.raw()).length, 1);
    await login("current");
    const projects = await a.projects();
    assert.equal(projects.length, 3);
    const repo = projects.find((p) => p.name === "repo");
    assert.equal(repo.path, "/work/repo");
    assert.equal((await a.sessions(repo.id)).length, 2);
    assert.equal(projects.find((p) => p.name.includes("space-1")).path, "");
    const app = createApp({
      adapters: { desktop: a },
      agentNames: { desktop: "Desktop" },
      token: "fixture",
      messages: {},
      operations: {},
      reads: {},
      saveReads() {},
      dist: root,
      getPort: () => server.address().port,
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const p = projects.find((p) => p.name.includes("space-1"));
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/desktop/sessions?projectId=${encodeURIComponent(p.id)}`,
        { headers: { Authorization: "Bearer fixture" } },
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json())[0].id, "local_cowork");
    } finally {
      app.locals.events.close();
      await new Promise((resolve) => server.close(resolve));
    }
    await assert.rejects(a.detail("local_old"), /missing/);
    await login("empty-account");
    assert.deepEqual(await a.projects(), []);
    await assert.rejects(a.detail("local_a"), /missing/);
    await login("../old");
    await assert.rejects(a.projects(), /无法确认/);
    await login("current");
    await add(
      "current",
      "second-org",
      "local-agent-mode-sessions",
      "local_other",
    );
    await assert.rejects(a.projects(), /多个组织/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
