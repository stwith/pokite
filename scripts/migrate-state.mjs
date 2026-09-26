import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { stateDirectory } from "../server/state-paths.mjs";
import { matchesProcessGeneration } from "../server/process-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, ".local"),
  target = stateDirectory();
const info = await fs.lstat(source).catch(() => null);
if (!info) {
  console.log("No legacy repository state to migrate.");
  process.exit(0);
}
if (info.isSymbolicLink()) {
  console.log("Legacy path already points to external state.");
  process.exit(0);
}
if (source === target)
  throw Error("Choose an external POKITE_STATE_DIR before migration");
const state = await fs
  .readFile(path.join(source, "server-state.json"), "utf8")
  .then(JSON.parse)
  .catch(() => null);
if (
  state &&
  matchesProcessGeneration({
    pid: state.pid,
    startedAt: Date.parse(state.startedAt),
  })
)
  throw Error("Stop Pokite before state migration");
if (
  await fs.access(target).then(
    () => true,
    () => false,
  )
)
  throw Error(
    "Target state directory already exists; refusing to overwrite it",
  );
const processList = execFileSync("/bin/ps", ["-axo", "args="], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
const remnants = (await fs.readdir(source, { withFileTypes: true }))
  .filter(
    (e) =>
      e.isDirectory() &&
      /^(desktop-proof-|shared-proof-|claude-main-proof$)/.test(e.name) &&
      !processList.includes(path.join(source, e.name)),
  )
  .map((e) => e.name);
console.log(
  JSON.stringify(
    {
      source,
      target,
      verificationDirectories: remnants.length,
      apply: process.argv.includes("--apply"),
    },
    null,
    2,
  ),
);
if (!process.argv.includes("--apply")) process.exit(0);
const trash = path.join(
  os.homedir(),
  ".Trash",
  "pokite-verification-" + Date.now(),
);
await fs.mkdir(trash, { recursive: true, mode: 0o700 });
for (const name of remnants)
  await fs.rename(path.join(source, name), path.join(trash, name));
await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
await fs.rename(source, target);
await fs.chmod(target, 0o700);
// Running Desktop children retain their token/state paths. Keep one ignored
// directory link until those clients are restarted, never duplicate state.
await fs.symlink(target, source, "dir");
console.log(
  "State migrated. Verification copies moved to private Trash (same disk, not an external backup). Legacy .local is a compatibility symlink for active Desktop processes.",
);
