import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { discoverMachine } from "../server/machine-discovery.mjs";
import { loadInstances, validateInstances } from "../server/instances.mjs";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    "enable-codex": { type: "boolean" },
  },
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".local"),
  file = process.env.POCKET_CONFIG || path.join(local, "instances.json");
const report = discoverMachine();
const present = await fs.access(file).then(
  () => true,
  () => false,
);
const instances =
  present || process.env.POCKET_CONFIG !== undefined
    ? loadInstances(file)
    : validateInstances(report.instances);
if (!instances.length)
  throw Error(
    "No supported existing sessions/services found. Run npm run discover and configure missing paths or service URLs.",
  );
console.log(
  JSON.stringify(
    {
      instances,
      existingConfigurationPreserved: present,
      candidates: report.candidates,
      dryRun: !!values["dry-run"],
    },
    null,
    2,
  ),
);
if (!values["dry-run"]) {
  if (!present) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, JSON.stringify({ instances }, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  }
  if (instances.some((x) => x.provider === "codex")) {
    execFileSync(
      process.execPath,
      [
        path.join(root, "scripts/setup-codex-sharing.mjs"),
        ...(values["enable-codex"] ? ["--enable"] : []),
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, POCKET_CONFIG: path.resolve(file) },
      },
    );
  }
}
