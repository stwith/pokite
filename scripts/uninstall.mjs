import fs from "node:fs/promises";
import { writeFileAtomicAsync } from "../server/json-file.mjs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stateDirectory, sharingConfigFile } from "../server/state-paths.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const local = stateDirectory();
const candidates = [
  path.join(local, "codex-desktop-launcher"),
  path.join(root, ".local/codex-desktop-launcher"),
  path.join(root, "scripts/codex-desktop-proxy.mjs"),
];
const apply = process.argv.includes("--apply");
let environment = "";
try {
  environment = execFileSync("/bin/launchctl", ["getenv", "CODEX_CLI_PATH"], {
    encoding: "utf8",
  }).trim();
} catch {}
console.log(
  apply
    ? "Removing Pokite launch overrides; preserving sessions and local state."
    : "Dry run. Use npm run uninstall -- --apply to remove Pokite launch overrides. State and sessions are preserved.",
);
if (apply) {
  const configFile = sharingConfigFile();
  const config = await fs
    .readFile(configFile, "utf8")
    .then(JSON.parse)
    .catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
  if (config) {
    for (const profile of Object.values(config.profiles || {}))
      profile.enabled = false;
    await writeFileAtomicAsync(configFile, JSON.stringify(config, null, 2));
  }
  for (const label of [
    "local.agent-pocket.codex-sharing",
    "app.pokite.codex-sharing",
  ]) {
    const file = path.join(
      os.homedir(),
      "Library/LaunchAgents",
      label + ".plist",
    );
    const contents = await fs.readFile(file, "utf8").catch(() => "");
    if (contents && candidates.some((p) => contents.includes(p))) {
      try {
        execFileSync(
          "/bin/launchctl",
          ["bootout", `gui/${process.getuid()}/${label}`],
          { stdio: "ignore" },
        );
      } catch {}
      await fs.unlink(file);
    }
  }
  if (candidates.includes(environment))
    execFileSync("/bin/launchctl", ["unsetenv", "CODEX_CLI_PATH"]);
  for (const name of await fs.readdir(os.homedir())) {
    if (!/^\.codex(?:[-_][\w-]+)?$/.test(name)) continue;
    const file = path.join(os.homedir(), name, "config.toml");
    const before = await fs.readFile(file, "utf8").catch(() => null);
    if (!before) continue;
    const after = before
      .split("\n")
      .filter(
        (line) =>
          !candidates.includes(
            line.match(/^\s*CODEX_CLI_PATH\s*=\s*(["'])(.*?)\1/)?.[2],
          ),
      )
      .join("\n");
    if (after !== before) {
      await fs.copyFile(file, file + ".pre-pokite-uninstall");
      await fs.writeFile(file, after);
    }
  }
  console.log(
    "Reopen Desktop after its tasks finish. The fallback launcher remains so running clients with inherited paths can still start the original backend. Stop Pokite with npm run stop before deleting its repository.",
  );
}
