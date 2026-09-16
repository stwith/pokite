import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { matchesProcessGeneration } from "../server/process-identity.mjs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const local =
  process.env.POCKET_STATE_DIR ||
  fileURLToPath(new URL("../.local", import.meta.url));
const state = JSON.parse(
  await fs.readFile(path.join(local, "server-state.json"), "utf8"),
);
const command = execFileSync(
  "/bin/ps",
  ["-p", String(state.pid), "-o", "command="],
  { encoding: "utf8" },
);
if (
  !command.includes(
    fileURLToPath(new URL("../server/index.mjs", import.meta.url)),
  ) ||
  !matchesProcessGeneration({
    pid: state.pid,
    startedAt: Date.parse(state.startedAt),
  })
)
  throw Error("PID no longer belongs to this service; not stopping it");
process.kill(state.pid, "SIGTERM");
const deadline = Date.now() + 60000;
while (
  matchesProcessGeneration({
    pid: state.pid,
    startedAt: Date.parse(state.startedAt),
  })
) {
  if (Date.now() > deadline)
    throw Error("Service is still draining. It was not force-killed.");
  await delay(100);
}
console.log("Pokite stopped after draining pending writes");
