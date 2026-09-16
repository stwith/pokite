import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { SharedRpc } from "../server/shared-rpc.mjs";
import { Rpc } from "../server/rpc.mjs";
import { Codex } from "../server/adapters.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
import { resolveCodexDesktopBinary } from "../server/machine-discovery.mjs";
import { renderDesktopLauncher } from "../server/sharing-setup.mjs";

const home = await fs.mkdtemp(path.resolve(".local/shared-proof-"));
const streams = new Set();
const requests = [];
let sequence = 0;
const provider = http.createServer((req, res) => {
  let body = "";
  req.on("data", (x) => (body += x));
  req.on("end", () => {
    try {
      requests.push(JSON.parse(body));
    } catch {}
  });
  const id = "proof-" + ++sequence,
    event = (type, data) =>
      res.write(
        "event: " +
          type +
          "\ndata: " +
          JSON.stringify({ type, ...data }) +
          "\n\n",
      );
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  event("response.created", {
    response: { id, status: "in_progress", output: [] },
  });
  res.finishProof = (text) => {
    const item = {
      type: "message",
      id: "message-" + id,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    };
    event("response.output_item.added", {
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    });
    event("response.output_text.delta", {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: text,
    });
    event("response.output_item.done", { output_index: 0, item });
    event("response.completed", {
      response: {
        id,
        status: "completed",
        output: [item],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      },
    });
    res.end();
  };
  streams.add(res);
  res.on("close", () => streams.delete(res));
});
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Proof condition timed out");
}
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
await fs.writeFile(
  path.join(home, "config.toml"),
  `model = "gpt-5.6-sol"\nmodel_provider = "proof"\n[model_providers.proof]\nname = "Local proof"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\nwire_api = "responses"\nenv_key = "POCKET_PROOF_KEY"\nsupports_websockets = false\nstream_idle_timeout_ms = 600000\n`,
  { mode: 0o600 },
);
const allocator = net.createServer();
await new Promise((resolve) => allocator.listen(0, "127.0.0.1", resolve));
const port = allocator.address().port;
await new Promise((resolve) => allocator.close(resolve));
const endpoint = "ws://127.0.0.1:" + port;
const proxyMode = process.env.POCKET_PROXY_PROOF === "1";
const configFile = path.join(home, "shared.json"),
  tokenFile = path.join(home, "token");
const launcher = path.join(home, "desktop-launcher");
await fs.writeFile(
  launcher,
  renderDesktopLauncher(
    process.execPath,
    path.resolve("scripts/codex-desktop-proxy.mjs"),
    configFile,
  ),
  { mode: 0o700 },
);
await fs.writeFile(
  configFile,
  JSON.stringify({
    profiles: { proof: { enabled: true, home, endpoint, tokenFile } },
  }),
  { mode: 0o600 },
);
const env = {
  ...process.env,
  CODEX_HOME: home,
  POCKET_PROOF_KEY: "isolated-test",
};
for (const key of Object.keys(env))
  if (key.startsWith("CODEX_") && key !== "CODEX_HOME") delete env[key];
const server = proxyMode
  ? null
  : spawn(
      resolveCodexDesktopBinary({
        explicit: process.env.POCKET_CODEX_DESKTOP_BIN,
      }),
      ["app-server", "--listen", endpoint],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );
let stderr = "";
server?.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-5000);
});
const desktop = proxyMode
  ? new Rpc(home, {
      binary: launcher,
      env: {
        POCKET_SHARED_CONFIG: configFile,
        POCKET_PROOF_KEY: "isolated-test",
        PATH: "/usr/bin:/bin",
      },
      args: [
        "-c",
        "features.code_mode_host=true",
        "app-server",
        "--analytics-default-enabled",
        "-c",
        'model_reasoning_effort="medium"',
      ],
    })
  : new SharedRpc(endpoint);
const phone = new SharedRpc(endpoint, proxyMode ? { tokenFile } : {});
try {
  if (proxyMode) await desktop.connect();
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(endpoint.replace("ws:", "http:") + "/readyz")).ok) break;
    } catch {}
    if (i === 50) throw Error("Shared server failed to start: " + stderr);
    await new Promise((r) => setTimeout(r, 100));
  }
  await desktop.connect();
  await phone.connect();
  const project = (
    await desktop.call("project/create", {
      name: "Shared proof",
      roots: [{ path: home }],
      idempotencyKey: "shared-proof",
    })
  ).project;
  const { thread } = await desktop.call("thread/start", {
    cwd: home,
    projectId: project.id,
  });
  const { turn } = await desktop.call("turn/start", {
    threadId: thread.id,
    input: [{ type: "text", text: "Hold this isolated fixture" }],
  });
  for (let i = 0; i < 100 && !streams.size; i++)
    await new Promise((r) => setTimeout(r, 50));
  assert.ok(streams.size, "Local provider receives the held request");
  await phone.call("thread/resume", {
    threadId: thread.id,
    excludeTurns: true,
  });
  const input = (text) => [{ type: "text", text }];
  const a = (
    await desktop.call("thread/queue/add", {
      threadId: thread.id,
      input: input("Desktop draft"),
      clientUserMessageId: "desktop-draft",
    })
  ).queuedSubmission;
  const b = (
    await phone.call("thread/queue/add", {
      threadId: thread.id,
      input: input("Phone follow-up"),
      clientUserMessageId: "phone-follow-up",
    })
  ).queuedSubmission;
  await assert.rejects(
    phone.call("thread/queue/start", {
      threadId: thread.id,
      queuedSubmissionId: b.id,
    }),
    /active or pending turn/,
  );
  const adapter = new Codex("proof", home, { control: phone });
  const outbox = new MessageQueue(path.join(home, "outbox.json"), {
    proof: adapter,
  });
  outbox.add("proof", thread.id, "Phone queued execution", "phone-exec", {
    model: "gpt-5.6-sol",
    effort: "high",
  });
  await outbox.tick();
  assert.equal(outbox.list("proof", thread.id)[0].state, "queued");
  await desktop.call("thread/queue/update", {
    threadId: thread.id,
    queuedSubmissionId: a.id,
    input: input("Desktop edited draft"),
  });
  const listed = await phone.call("thread/queue/list", { threadId: thread.id });
  assert.deepEqual(
    listed.data.map((x) => x.id),
    [a.id, b.id],
  );
  assert.equal(
    JSON.stringify(listed.data[0]).includes("Desktop edited draft"),
    true,
  );
  await phone.close();
  const reconnected = new SharedRpc(endpoint, proxyMode ? { tokenFile } : {});
  try {
    const again = await reconnected.call("thread/queue/list", {
      threadId: thread.id,
    });
    assert.deepEqual(
      again.data.map((x) => x.id),
      [a.id, b.id],
    );
  } finally {
    reconnected.close();
  }
  await desktop.call("thread/queue/delete", {
    threadId: thread.id,
    queuedSubmissionId: b.id,
  });
  await desktop.call("thread/queue/update", {
    threadId: thread.id,
    queuedSubmissionId: a.id,
    input: input("Desktop still editable"),
  });
  await desktop.call("thread/queue/delete", {
    threadId: thread.id,
    queuedSubmissionId: a.id,
  });
  await desktop.call("turn/interrupt", {
    threadId: thread.id,
    turnId: turn.id,
  });
  for (const stream of streams) stream.end();
  await until(() => streams.size === 0);
  await outbox.tick();
  assert.equal(outbox.list("proof", thread.id).length, 0);
  await until(() => streams.size > 0);
  assert.equal(requests.at(-1).reasoning?.effort, "high");
  [...streams].at(-1).finishProof("PHONE_OK");
  await until(
    async () =>
      (
        await desktop.call("thread/read", {
          threadId: thread.id,
          includeTurns: false,
        })
      ).thread.status.type === "idle",
  );
  await desktop.call("turn/start", {
    threadId: thread.id,
    input: input("Desktop continuation"),
  });
  await until(() => streams.size > 0);
  [...streams].at(-1).finishProof("DESKTOP_OK");
  await until(
    async () =>
      (
        await desktop.call("thread/read", {
          threadId: thread.id,
          includeTurns: false,
        })
      ).thread.status.type === "idle",
  );
  const history = await adapter.detail(thread.id);
  assert.ok(history.messages.some((m) => m.text === "PHONE_OK"));
  assert.ok(history.messages.some((m) => m.text === "DESKTOP_OK"));
  if (proxyMode) {
    const unauthenticated = new SharedRpc(endpoint);
    try {
      await assert.rejects(unauthenticated.connect(), /401|Unauthorized/);
    } finally {
      unauthenticated.close();
    }
    phone.close();
    desktop.close();
    await until(() => desktop.proc.exitCode !== null);
    const freshDesktop = new Rpc(home, {
      binary: launcher,
      env: {
        POCKET_SHARED_CONFIG: configFile,
        POCKET_PROOF_KEY: "isolated-test",
      },
    });
    const freshPhone = new SharedRpc(endpoint, { tokenFile });
    try {
      await freshDesktop.connect();
      assert.equal(
        (await freshPhone.call("thread/queue/list", { threadId: thread.id }))
          .data.length,
        0,
      );
      const cold = new Codex("proof", home, { control: freshPhone });
      await cold.send(thread.id, "Cold session reply", "cold-reply", {
        model: "gpt-5.6-sol",
        effort: "high",
      });
      await until(() => streams.size > 0);
      [...streams].at(-1).finishProof("COLD_OK");
      await until(
        async () =>
          (
            await freshDesktop.call("thread/read", {
              threadId: thread.id,
              includeTurns: false,
            })
          ).thread.status.type === "idle",
      );
      assert.ok(
        (await cold.detail(thread.id)).messages.some(
          (m) => m.text === "COLD_OK",
        ),
      );
      cold.close();
    } finally {
      freshPhone.close();
      freshDesktop.close();
      await until(() => freshDesktop.proc.exitCode !== null);
    }
    const oldToken = await fs.readFile(tokenFile, "utf8");
    const occupied = http.createServer((req, res) => res.end("occupied"));
    await new Promise((resolve) => occupied.listen(port, "127.0.0.1", resolve));
    const fallback = new Rpc(home, {
      binary: launcher,
      env: {
        POCKET_SHARED_CONFIG: configFile,
        POCKET_PROOF_KEY: "isolated-test",
      },
    });
    try {
      await fallback.connect();
      assert.equal(
        (
          await fallback.call("thread/read", {
            threadId: thread.id,
            includeTurns: false,
          })
        ).thread.id,
        thread.id,
      );
      assert.equal(await fs.readFile(tokenFile, "utf8"), oldToken);
      assert.equal(
        await fs
          .stat(path.join(home, "codex-shared-proof.state.json"))
          .catch(() => null),
        null,
      );
    } finally {
      fallback.close();
      await until(() => fallback.proc.exitCode !== null);
      await new Promise((resolve) => occupied.close(resolve));
    }
  }
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "two clients share one thread",
        "phone append preserves desktop queue ID",
        "desktop edit succeeds after phone append",
        "reconnect preserves queue",
        "busy queue start cannot interrupt",
        "phone adapter submits with high effort",
        "desktop continues after phone",
        ...(proxyMode
          ? [
              "unauthenticated WebSocket rejected",
              "cold session resumes after backend restart",
              "occupied shared port preserves normal Desktop transport",
            ]
          : []),
      ],
      home,
    }),
  );
} catch (e) {
  console.error("Shared proof failed:", e.message);
  throw e;
} finally {
  desktop.close();
  phone.close();
  const child = server || desktop.proc;
  child.kill("SIGINT");
  const force = setTimeout(() => child.kill("SIGKILL"), 6000);
  if (child.exitCode === null)
    await new Promise((resolve) => child.once("exit", resolve));
  clearTimeout(force);
  for (const stream of streams) stream.destroy();
  await new Promise((resolve) => provider.close(resolve));
}
