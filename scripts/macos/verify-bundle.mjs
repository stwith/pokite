import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
const bundle = path.resolve(process.argv[2] || "artifacts/macos/Pokite.app");
const resources = path.join(bundle, "Contents/Resources");
const app = path.join(resources, "app");
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
const files = [];
async function scan(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (
      e.name === ".git" ||
      e.name === ".local" ||
      e.name === "access-token" ||
      e.name === "push.json" ||
      e.name === ".env"
    )
      throw Error("Private state in bundle: " + e.name);
    if (e.isDirectory()) await scan(path.join(dir, e.name));
    else if (!e.isSymbolicLink()) files.push(path.join(dir, e.name));
  }
}
await scan(app);
for (const file of [
  "server/index.mjs",
  "shared/i18n.mjs",
  "scripts/codex-desktop-proxy.mjs",
  "scripts/setup-hermes-sharing.mjs",
  "dist/index.html",
])
  await fs.access(path.join(app, file));
const state = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-bundle-"));
let child;
try {
  await fs.writeFile(
    path.join(state, "instances.json"),
    JSON.stringify({ instances: [] }),
  );
  child = spawn(
    path.join(resources, "runtime/node"),
    [path.join(app, "server/index.mjs")],
    {
      cwd: app,
      env: {
        ...process.env,
        POKITE_STATE_DIR: state,
        POKITE_CONFIG: path.join(state, "instances.json"),
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const exit = once(child, "exit");
  let timer;
  const ready = await Promise.race([
    once(child, "message").then(([m]) => m),
    exit.then(() => {
      throw Error("Bundled server exited before readiness");
    }),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error("Bundled startup timed out")),
        20000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  const token = (
    await fs.readFile(path.join(state, "access-token"), "utf8")
  ).trim();
  const base = `http://127.0.0.1:${ready.port}`;
  assert.equal((await fetch(base + "/api/agents")).status, 401);
  const deniedEnglish = await fetch(base + "/api/agents", {headers:{"Accept-Language":"en-US"}});
  assert.equal((await deniedEnglish.json()).error, "Enter your access code");
  const r = await fetch(base + "/api/agents", {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), []);
  assert.equal((await fetch(base + "/")).status, 200);
  child.kill("SIGTERM");
  assert.equal((await exit)[0], 0);
  child = null;
  console.log(
    JSON.stringify({
      signature: "passed",
      privateState: "absent",
      files: files.length,
      packagedServer: "passed",
      desktopProcessesTouched: false,
    }),
  );
} finally {
  child?.kill("SIGTERM");
  await fs.rm(state, { recursive: true, force: true });
}
