import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.resolve(
  process.env.POCKET_STATE_DIR || path.join(root, ".local"),
);
fs.mkdirSync(local, { recursive: true, mode: 0o700 });
const log = fs.openSync(path.join(local, "server.log"), "a", 0o600);
const child = spawn(process.execPath, [path.join(root, "server/index.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    POCKET_STATE_DIR: local,
    ...(process.env.POCKET_CONFIG
      ? { POCKET_CONFIG: path.resolve(process.env.POCKET_CONFIG) }
      : {}),
  },
  detached: true,
  stdio: ["ignore", log, log, "ipc"],
});
fs.closeSync(log);
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        Error(
          "Service startup timed out; see " + path.join(local, "server.log"),
        ),
      );
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        Error(
          "Service failed before readiness (exit " +
            code +
            "); see " +
            path.join(local, "server.log"),
        ),
      );
    });
    child.on("message", (message) => {
      if (message.type === "ready") {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
  child.unref();
  console.log("Pokite ready, PID " + ready.pid + ", port " + ready.port);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
