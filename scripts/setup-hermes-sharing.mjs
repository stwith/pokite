import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const home = path.resolve(
  process.env.HERMES_HOME || path.join(os.homedir(), ".hermes"),
);
const runtime = path.join(home, "hermes-agent");
const profile = process.argv[2];
if (profile && !/^[a-zA-Z0-9_-]+$/.test(profile))
  throw new Error("Invalid Hermes profile");
const python = path.join(runtime, "venv/bin/python");
await fs.access(python);
const source = fileURLToPath(
  new URL("../integrations/hermes-desktop/", import.meta.url),
);
const target = path.join(
  home,
  profile ? "profiles/" + profile : "",
  "plugins/pokite",
);
await fs.cp(source, target, { recursive: true });
execFileSync(
  python,
  [
    "-m",
    "hermes_cli.main",
    ...(profile ? ["--profile", profile] : []),
    "plugins",
    "enable",
    "pokite",
  ],
  {
    cwd: runtime,
    env: { ...process.env, HERMES_HOME: home },
    input: "n\n",
    stdio: ["pipe", "inherit", "inherit"],
    timeout: 15000,
  },
);
console.log(
  "Pokite Hermes plugin installed. Reopen Hermes Desktop after its tasks finish.",
);
