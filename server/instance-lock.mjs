import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { processStartedAt } from "./process-identity.mjs";

export function acquireInstanceLock(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Also recognize a running pre-lock version during the first upgrade.
  try {
    const state = JSON.parse(
      fs.readFileSync(path.join(directory, "server-state.json"), "utf8"),
    );
    const birth = processStartedAt(state.pid);
    if (birth !== null && birth <= Date.parse(state.startedAt) + 1000)
      throw Object.assign(Error("This service is already running"), {
        code: "ALREADY_RUNNING",
      });
  } catch (error) {
    if (error.code === "ALREADY_RUNNING") throw error;
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  const file = path.join(directory, "server.lock"),
    nonce = randomUUID();
  let fd;
  try {
    fd = fs.openSync(file, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error(
        "Service lock exists. Another instance may be running; inspect server.lock before removing a stale lock.",
      );
    throw error;
  }
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, nonce, startedAt: Date.now() }),
    );
  } catch (error) {
    fs.closeSync(fd);
    fs.unlinkSync(file);
    throw error;
  }
  fs.closeSync(fd);
  return () => {
    try {
      if (JSON.parse(fs.readFileSync(file, "utf8")).nonce === nonce)
        fs.unlinkSync(file);
    } catch {
      /* Never delete a replacement or unverifiable lock. */
    }
  };
}
