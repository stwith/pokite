#!/usr/bin/env node
import { sharingConfigFile } from "../server/state-paths.mjs";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { execFile, execFileSync } from "node:child_process";
import { probeDesktopTransport } from "../server/sharing-setup.mjs";
import { writeFileAtomic } from "../server/json-file.mjs";
import {
  desktopBackendForCaller,
  isDesktopAppCaller,
  resolveCodexDesktopBinary,
} from "../server/machine-discovery.mjs";

// Import/link the complete dependency graph without touching accounts, config or
// execution. The shell launcher can still exec the native backend on failure.
if (process.argv.length === 3 && process.argv[2] === "--pokite-preflight")
  process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const configFile = sharingConfigFile();
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
// Desktop pauses the whole app when its backend cannot start, so every Pokite
// failure before handover degrades to the native backend instead of exiting.
const fallbackFile = path.join(
  path.dirname(configFile),
  "codex-desktop-fallback.json",
);
function recordFallback(reason) {
  console.error("Pokite: using the native Codex backend:", reason);
  try {
    fsSync.writeFileSync(
      fallbackFile,
      JSON.stringify({ time: Date.now(), home, reason }),
      { mode: 0o600 },
    );
  } catch {}
}
let binary;
try {
  binary = resolveCodexDesktopBinary({
    explicit:
      found?.[1].binary ||
      config?.binary ||
      process.env.POCKET_CODEX_DESKTOP_BIN,
    parentExecutable,
  });
} catch (e) {
  binary = desktopBackendForCaller(parentExecutable);
  if (!binary) throw e;
  recordFallback(e.message);
}
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
let intercept =
  found &&
  isDesktopAppCaller(parentExecutable, binary) &&
  globalFlags &&
  (!args[command + 1] || args[command + 1].startsWith("-")) &&
  (listen < 0 || args[listen + 1] === "stdio://");
// Re-probe the backend once per build (i.e. after each Desktop update) and
// stop intercepting while it lacks the transport or methods Pokite relies on.
const compatFile = path.join(
  path.dirname(configFile),
  "codex-desktop-compat.json",
);
function notifyIncompatible() {
  if (process.platform !== "darwin" || process.env.POKITE_DISABLE_NOTIFICATIONS)
    return;
  execFile(
    "/usr/bin/osascript",
    [
      "-e",
      /^zh/i.test(process.env.POKITE_LANGUAGE || process.env.LANG || "")
        ? 'display notification "Codex 更新后与 Pokite 不兼容，已暂停接管；Codex 仍可正常使用。" with title "Pokite"'
        : 'display notification "Codex was updated and is not compatible with Pokite. Sharing is paused; Codex still works normally." with title "Pokite"',
    ],
    { timeout: 3000 },
    () => {},
  );
}
function backendCompatibility() {
  let fingerprint;
  try {
    const stat = fsSync.statSync(binary);
    fingerprint = [binary, stat.size, stat.mtimeMs].join(":");
  } catch {
    return { compatible: true };
  }
  try {
    const saved = JSON.parse(fsSync.readFileSync(compatFile, "utf8"));
    if (saved.fingerprint === fingerprint) return saved;
  } catch {}
  const result = { fingerprint, binary, compatible: true, reason: null };
  try {
    result.version = probeDesktopTransport(binary).version;
  } catch (e) {
    result.compatible = false;
    result.reason = e.message;
    notifyIncompatible();
  }
  result.checkedAt = Date.now();
  try {
    fsSync.writeFileSync(compatFile, JSON.stringify(result), { mode: 0o600 });
  } catch {}
  return result;
}
if (intercept) {
  const compatibility = backendCompatibility();
  if (!compatibility.compatible) {
    recordFallback("Incompatible Codex backend: " + compatibility.reason);
    intercept = false;
  }
}
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
  const stateFile = path.join(
    path.dirname(configFile),
    `codex-shared-${id}.state.json`,
  );
  const lockFile = stateFile + ".lock";
  let child,
    socket,
    stopping = false,
    ownsLock = false,
    handedOver = false,
    abandoning = false,
    initializeId;
  let state;
  const saveState = () => {
    writeFileAtomic(stateFile, JSON.stringify(state));
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
    if (ownsLock) {
      await fs.unlink(lockFile).catch(() => {});
      await fs.unlink(stateFile).catch(() => {});
    }
    process.exit(code);
  }
  // Undo the shared transport's setup so the native backend starts cleanly.
  async function abandon() {
    abandoning = true;
    for (const signal of ["SIGINT", "SIGTERM"])
      process.removeAllListeners(signal);
    process.stdin.removeAllListeners("end");
    process.stdin.removeAllListeners("error");
    process.stdout.removeAllListeners("error");
    socket?.terminate();
    if (child && child.exitCode === null) {
      child.kill("SIGINT");
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      await new Promise((resolve) => child.once("exit", resolve));
      clearTimeout(force);
    }
    if (ownsLock) {
      await fs.unlink(lockFile).catch(() => {});
      await fs.unlink(stateFile).catch(() => {});
    }
  }
  try {
    const endpoint = new URL(profile.endpoint);
    if (endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1")
      throw Error("Invalid shared endpoint");
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
    ownsLock = true;
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    await lock.close();
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
    // Before handover a dead backend means "fall back", not "fail Desktop".
    let startupFailure;
    child.once("error", (e) => {
      if (!handedOver) startupFailure = e;
      else if (!abandoning) {
        console.error(e.message);
        void stop(1);
      }
    });
    child.once("exit", (code) => {
      if (!handedOver)
        startupFailure ??= Error(
          "Shared app-server exited during startup (" + code + ")",
        );
      else if (!stopping && !abandoning) void stop(code ?? 1);
    });
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => void stop());
    process.stdin.once("end", () => void stop());
    process.stdin.on("error", () => void stop(1));
    process.stdout.on("error", () => void stop());
    for (let i = 0; ; i++) {
      if (startupFailure) throw startupFailure;
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
    handedOver = true;
  } catch (e) {
    if (handedOver) {
      console.error("Pokite shared transport:", e.message);
      await stop(1);
    }
    await abandon();
    recordFallback(
      e.code === "EADDRINUSE" ? "shared-port-in-use: " + e.message : e.message,
    );
    await originalTransport();
  }
}
