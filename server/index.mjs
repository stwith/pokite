import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeAdapters } from "./adapters.mjs";
import { loadInstances } from "./instances.mjs";
import { acquireInstanceLock } from "./instance-lock.mjs";
import { Operations } from "./operations.mjs";
import { MessageQueue } from "./message-queue.mjs";
import { createApp } from "./app.mjs";
import { shutdownServer } from "./shutdown.mjs";
import os from "node:os";
import { execFile } from "node:child_process";
import { DesktopErrorMonitor } from "./desktop-error-monitor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.resolve(
  process.env.POCKET_STATE_DIR || path.join(root, ".local"),
);
const instances = loadInstances();
const release = acquireInstanceLock(local);
process.once("exit", release);
let shutdown;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (shutdown) void shutdown();
    else process.exit(1);
  });

let port = Number(process.env.PORT || 3230);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw Error("Invalid PORT");
if (port !== 0)
  await new Promise((resolve, reject) => {
    const probe = net.connect({ host: "127.0.0.1", port });
    probe.once("connect", () => {
      probe.destroy();
      reject(Error("Port is already in use: " + port));
    });
    probe.once("error", (error) => {
      if (error.code === "ECONNREFUSED") resolve();
      else reject(error);
    });
    probe.setTimeout(1000, () => {
      probe.destroy();
      reject(Error("Cannot verify that port is available"));
    });
  });
let app;
const server = http.createServer((req, res) => {
  if (app) app(req, res);
  else {
    res.writeHead(503);
    res.end("Service starting");
  }
});
// Bind before constructing anything that may write queues or native state.
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "0.0.0.0", resolve);
});
port = server.address().port;
try {
  await fs.chmod(local, 0o700);
  const tokenFile = path.join(local, "access-token");
  let token;
  try {
    token = (await fs.readFile(tokenFile, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    token = randomBytes(24).toString("base64url");
    await fs.writeFile(tokenFile, token, { mode: 0o600 });
  }
  if (!token) throw Error("Access token must not be empty");
  const adapters = makeAdapters(instances);
  const agentNames = Object.fromEntries(
    Object.entries(adapters).map(([id, adapter]) => [id, adapter.name]),
  );
  const messages = new MessageQueue(
    path.join(local, "message-queue.json"),
    adapters,
  );
  const readFile = path.join(local, "read.json");
  const reads = JSON.parse(
    await fs.readFile(readFile, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    }),
  );
  const operations = new Operations(path.join(local, "operations.json"));
  let writeQueue = Promise.resolve(),
    readError;
  function saveReads() {
    const snapshot = JSON.stringify(reads);
    writeQueue = writeQueue
      .then(() => fs.writeFile(readFile + ".tmp", snapshot, { mode: 0o600 }))
      .then(() => fs.rename(readFile + ".tmp", readFile))
      .then(() => {
        readError = null;
      })
      .catch((error) => {
        readError = error;
        console.error("Read markers:", error.message);
      });
    return writeQueue;
  }
  app = createApp({
    adapters,
    agentNames,
    token,
    messages,
    operations,
    reads,
    saveReads,
    dist: path.join(root, "dist"),
    getPort: () => port,
  });
  const queueTimer = setInterval(
    () =>
      messages.tick().catch((error) => console.error("Queue:", error.message)),
    2000,
  );
  let stopping;
  const monitor = new DesktopErrorMonitor({
    root: path.join(os.homedir(), "Library/Logs/com.openai.codex"),
    report: path.join(local, "desktop-errors.jsonl"),
    onAlert: (event) => {
      console.error("Desktop queue error observed:", event.time, event.source);
      if (process.platform === "darwin")
        execFile(
          "/usr/bin/osascript",
          [
            "-e",
            'display notification "检测到新的 Desktop 队列提交错误，已记录诊断时间；未重发或修改消息。" with title "Pokite"',
          ],
          { timeout: 3000 },
          () => {},
        );
    },
  });
  await monitor
    .tick()
    .catch((error) =>
      console.error("Desktop monitor:", error.code || "read failed"),
    );
  const monitorTimer = setInterval(
    () =>
      monitor
        .tick()
        .catch((error) =>
          console.error("Desktop monitor:", error.code || "read failed"),
        ),
    5000,
  );
  shutdown = () =>
    (stopping ||= (async () => {
      clearInterval(queueTimer);
      clearInterval(monitorTimer);
      await shutdownServer({
        app,
        server,
        messages,
        adapters,
        flushReads: async () => {
          await writeQueue;
          if (readError) throw readError;
        },
      });
      await monitor.close();
      process.exit(0);
    })().catch((error) => {
      console.error("Shutdown failed:", error.message);
      process.exit(1);
    }));
  await fs.writeFile(
    path.join(local, "server-state.json"),
    JSON.stringify({
      pid: process.pid,
      port,
      startedAt: new Date().toISOString(),
    }),
  );
  console.log("Pokite listening on port " + port);
  if (process.connected)
    process.send({ type: "ready", pid: process.pid, port }, () => {
      if (process.connected) process.disconnect();
    });
} catch (error) {
  server.close();
  server.closeAllConnections();
  throw error;
}
