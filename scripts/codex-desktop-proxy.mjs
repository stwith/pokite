#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { execFileSync } from "node:child_process";
import { resolveCodexDesktopBinary } from "../server/machine-discovery.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const configFile =
  process.env.POCKET_SHARED_CONFIG ||
  path.join(root, ".local/codex-shared.json");
const home = path.resolve(
  process.env.CODEX_HOME || path.join(process.env.HOME, ".codex"),
);
let config;
try {
  config = JSON.parse(await fs.readFile(configFile, "utf8"));
} catch {}
const found = Object.entries(config?.profiles || {}).find(
  ([, p]) => p.enabled && path.resolve(p.home) === home,
);
let parentExecutable;
try {
  parentExecutable = execFileSync(
    "/bin/ps",
    ["-p", String(process.ppid), "-o", "comm="],
    { encoding: "utf8", timeout: 1000 },
  ).trim();
} catch {}
const binary = resolveCodexDesktopBinary({
  explicit:
    found?.[1].binary || config?.binary || process.env.POCKET_CODEX_DESKTOP_BIN,
  parentExecutable,
});
const listen = args.indexOf("--listen");
const command = args.indexOf("app-server");
const globalFlags =
  command >= 0 &&
  args
    .slice(0, command)
    .every(
      (arg, i) =>
        arg.startsWith("-") ||
        ["-c", "--config", "--enable", "--disable", "-p", "--profile"].includes(
          args[i - 1],
        ),
    );
const intercept =
  found &&
  globalFlags &&
  (!args[command + 1] || args[command + 1].startsWith("-")) &&
  (listen < 0 || args[listen + 1] === "stdio://");
async function originalTransport() {
  const child = spawn(binary, args, { stdio: "inherit", env: process.env });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      child.kill(signal === "SIGTERM" && globalFlags ? "SIGINT" : signal),
    );
  child.on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  process.exit(code ?? 1);
}
if (!intercept) await originalTransport();
else {
  const [id, profile] = found;
  const endpoint = new URL(profile.endpoint);
  if (endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1")
    throw Error("Invalid shared endpoint");
  const stateFile = path.join(
    path.dirname(configFile),
    `codex-shared-${id}.state.json`,
  );
  const lockFile = stateFile + ".lock";
  let lock;
  try {
    lock = await fs.open(lockFile, "wx", 0o600);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const old = JSON.parse(await fs.readFile(lockFile, "utf8"));
    let alive = true;
    try {
      process.kill(old.pid, 0);
    } catch {
      alive = false;
    }
    if (alive)
      throw Error("Shared Codex launcher is already running for " + id);
    await fs.unlink(lockFile);
    lock = await fs.open(lockFile, "wx", 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  await lock.close();
  let child,
    socket,
    stopping = false,
    initializeId;
  let state;
  const saveState = () => {
    fsSync.writeFileSync(stateFile + ".tmp", JSON.stringify(state), {
      mode: 0o600,
    });
    fsSync.renameSync(stateFile + ".tmp", stateFile);
  };
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    socket?.terminate();
    if (child && child.exitCode === null) {
      child.kill("SIGINT");
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      await new Promise((resolve) => child.once("exit", resolve));
      clearTimeout(force);
    }
    await fs.unlink(lockFile).catch(() => {});
    await fs.unlink(stateFile).catch(() => {});
    process.exit(code);
  }
  try {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(Number(endpoint.port), "127.0.0.1", resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
    const token = randomBytes(32).toString("base64url");
    await fs.writeFile(profile.tokenFile, token, { mode: 0o600 });
    await fs.chmod(profile.tokenFile, 0o600);
    const serverArgs = [...args];
    if (listen >= 0) serverArgs.splice(listen, 2);
    serverArgs.push(
      "--listen",
      profile.endpoint,
      "--ws-auth",
      "capability-token",
      "--ws-token-file",
      profile.tokenFile,
    );
    // Preserve Desktop's original env/config overrides; only the transport changes.
    child = spawn(binary, serverArgs, {
      env: process.env,
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.once("error", (e) => {
      console.error(e.message);
      void stop(1);
    });
    child.once("exit", (code) => {
      if (!stopping) void stop(code ?? 1);
    });
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => void stop());
    process.stdin.once("end", () => void stop());
    process.stdin.on("error", () => void stop(1));
    process.stdout.on("error", () => void stop());
    for (let i = 0; ; i++) {
      try {
        if (
          (
            await fetch(profile.endpoint.replace("ws:", "http:") + "/readyz", {
              signal: AbortSignal.timeout(500),
            })
          ).ok
        )
          break;
      } catch {}
      if (i === 100) throw Error("Shared app-server startup timed out");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    socket = new WebSocket(profile.endpoint, {
      headers: { Authorization: "Bearer " + token },
      perMessageDeflate: false,
      maxPayload: 256 * 1024 * 1024,
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.on("message", (data) => {
      try {
        const m = JSON.parse(data.toString());
        if (initializeId !== undefined && m.id === initializeId && m.result) {
          state.desktopReady = true;
          saveState();
        }
      } catch {}
      if (!process.stdout.write(data.toString() + "\n")) socket.pause();
    });
    process.stdout.on("drain", () => socket.resume());
    socket.on("close", () => void stop());
    socket.on("error", () => void stop(1));
    state = {
      pid: process.pid,
      desktopPid: process.ppid,
      backendPid: child.pid,
      home,
      endpoint: profile.endpoint,
      startedAt: Date.now(),
      desktopReady: false,
    };
    saveState();
    createInterface({ input: process.stdin, crlfDelay: Infinity }).on(
      "line",
      (line) => {
        try {
          const m = JSON.parse(line);
          if (m.method === "initialize") {
            initializeId = m.id;
            state.clientInfo = m.params?.clientInfo;
          }
        } catch {}
        if (socket.readyState === WebSocket.OPEN) socket.send(line);
      },
    );
  } catch (e) {
    if (!child && e.code === "EADDRINUSE") {
      let previous;
      try {
        previous = JSON.parse(await fs.readFile(stateFile, "utf8"));
      } catch {}
      let activeBackend = false;
      if (previous?.backendPid)
        try {
          process.kill(previous.backendPid, 0);
          activeBackend = true;
        } catch {}
      if (!activeBackend) {
        await fs.unlink(lockFile).catch(() => {});
        await fs.unlink(stateFile).catch(() => {});
        await fs.writeFile(
          stateFile + ".fallback.json",
          JSON.stringify({ time: Date.now(), reason: "shared-port-in-use" }),
          { mode: 0o600 },
        );
        await originalTransport();
      }
    }
    console.error("Pokite shared transport:", e.message);
    await stop(1);
  }
}
