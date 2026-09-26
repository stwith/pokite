import { stateDirectory } from "./state-paths.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import net from "node:net";
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
import { PushService } from "./push.mjs";
import { rotateAccessToken, generateAccessToken } from "./access-token.mjs";
import { NetworkListeners } from "./network-listeners.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = stateDirectory();
const network = await fs
  .readFile(path.join(local, "network.json"), "utf8")
  .then(JSON.parse)
  .catch((e) => {
    if (e.code === "ENOENT") return {};
    throw e;
  });
const allowLan =
  process.env.POKITE_ALLOW_LAN === "true" || network.allowLan === true;
const instances = loadInstances(undefined, { includeDisabled: true });
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
let networkListeners;
// Bind before constructing anything that may write queues or native state.
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, allowLan ? "0.0.0.0" : "127.0.0.1", resolve);
});
port = server.address().port;
try {
  networkListeners = new NetworkListeners({
    port,
    allowLan,
    handler: (req, res) => (app ? app(req, res) : res.writeHead(503).end()),
  });
  await networkListeners.refresh();
  networkListeners.start();
  await fs.chmod(local, 0o700);
  const tokenFile = path.join(local, "access-token");
  let token;
  try {
    token = (await fs.readFile(tokenFile, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    token = generateAccessToken();
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
  operations.save();
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
  const push = new PushService(local, adapters);
  // Retire the device registry; there is one owner-managed access code now.
  await fs.rm(path.join(local, "devices.json"), { force: true });
  app = createApp({
    push,
    getToken: () => token,
    resetAccess: () => {
      push.state.devices = {};
      push.state.outbox = [];
      push.save();
      token = rotateAccessToken(local);
      return token;
    },
    allowLan,
    adapters,
    agentNames,
    token,
    messages,
    operations,
    reads,
    saveReads,
    dist: path.join(root, "dist"),
    getPort: () => port,
    getListeningAddresses: () => networkListeners.listening(),
    getTailnetAddresses: () => networkListeners.tailnet,
  });
  push.start();
  const retentionTimer = setInterval(() => {
    try {
      operations.save();
      messages.save();
    } catch {
      console.error("State retention failed; existing receipts preserved.");
    }
  }, 3600000);
  retentionTimer.unref();
  const queueTimer = setInterval(
    () =>
      messages.tick().catch((error) => console.error("Queue:", error.message)),
    2000,
  );
  let stopping;
  const monitor = instances.some((x) => x.provider === "codex")
    ? new DesktopErrorMonitor({
        root: path.join(os.homedir(), "Library/Logs/com.openai.codex"),
        report: path.join(local, "desktop-errors.jsonl"),
        onAlert: (event) => {
          console.error(
            "Desktop queue error observed:",
            event.time,
            event.source,
          );
          if (process.platform === "darwin")
            execFile(
              "/usr/bin/osascript",
              [
                "-e",
                /^zh/i.test(
                  process.env.POKITE_LANGUAGE || process.env.LANG || "",
                )
                  ? 'display notification "检测到 Desktop 队列错误；已记录，未重发消息。" with title "Pokite"'
                  : 'display notification "Desktop queue error recorded. No messages were resent." with title "Pokite"',
              ],
              { timeout: 3000 },
              () => {},
            );
        },
      })
    : null;
  await monitor
    ?.tick()
    .catch((error) =>
      console.error("Desktop monitor:", error.code || "read failed"),
    );
  const monitorTimer = monitor
    ? setInterval(
        () =>
          monitor
            .tick()
            .catch((error) =>
              console.error("Desktop monitor:", error.code || "read failed"),
            ),
        5000,
      )
    : null;
  shutdown = () =>
    (stopping ||= (async () => {
      networkListeners.close(false);
      clearInterval(queueTimer);
      clearInterval(retentionTimer);
      clearInterval(monitorTimer);
      await push.close();
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
      await monitor?.close();
      networkListeners.close();

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
  networkListeners?.close();
  server.close();
  server.closeAllConnections();
  throw error;
}
