import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ClaudeDesktopRemote } from "../server/claude-desktop-remote.mjs";

test("Claude detail fetches one session and one visible page; warm lists refresh without blocking", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-performance-"));
  let now = 0,
    release,
    blocked = false,
    version = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
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
          { id: "p", name: "Project" },
          { id: "other", name: "Other" },
        ],
      }),
    );
    await fs.writeFile(
      path.join(dir, "remote-session-spaces.json"),
      JSON.stringify({
        entries: [
          { sessionId: "session_a", spaceId: "p" },
          { sessionId: "session_b", spaceId: "p" },
          { sessionId: "session_c", spaceId: "other" },
        ],
      }),
    );
    const client = {
      identity: async () => ({ account: "account", organization: "org" }),
      close: async () => {},
      request: async (route) => {
        calls.push(route);
        if (route.includes("/events"))
          return {
            data: [
              {
                sequence_num: "1",
                payload: {
                  type: "assistant",
                  uuid: "m",
                  message: { content: "recent" },
                },
              },
            ],
            next_cursor: "earlier",
          };
        if (blocked) await gate;
        return {
          session: {
            id: route.split("/").at(-1),
            title: "Title " + version,
            status: "active",
            worker_status: "idle",
          },
        };
      },
    };
    const a = new ClaudeDesktopRemote(root, { client, now: () => now });
    const projects = await a.projects();
    assert.equal(projects[0].name, "Cowork · Project");
    assert.equal(calls.length, 0);
    const id = "remote:account:org:cse_a";
    const [detail] = await Promise.all([
      a.detail(id),
      a.models(projects[0], id),
    ]);
    assert.equal(calls.filter((r) => !r.includes("/events")).length, 1);
    assert.equal(calls.filter((r) => r.includes("/events")).length, 1);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.hasMore, true);
    await a.detail(id);
    assert.equal(calls.length, 2);
    await a.sessions(projects[0].id);
    assert.equal(
      calls.some((r) => r.includes("cse_c")),
      false,
    );
    now = 5000;
    blocked = true;
    version = 1;
    let settled = false;
    const stale = a.sessions(projects[0].id).then((rows) => {
      settled = true;
      return rows;
    });
    for (let i = 0; i < 20 && !settled; i++)
      await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(settled, true, "list must not await the blocked refresh");
    assert.equal((await stale)[0].title, "Title 0");
    const pending = a.models(projects[0], id);
    const count = calls.length;
    release();
    await pending;
    assert.equal(
      calls.length,
      count,
      "detail/model refresh must reuse the pending metadata request",
    );
    assert.equal((await a.sessions(projects[0].id))[0].title, "Title 1");
    await a.close();
  } finally {
    release();
    await fs.rm(root, { recursive: true, force: true });
  }
});
