import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proxy = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/codex-desktop-proxy.mjs",
);

// A fake Desktop bundle whose host executable is node itself, so the proxy
// sees a Desktop parent exactly as it does under the real app.
// A compatible backend advertises the shared transport flags and methods
// that probeDesktopTransport requires; an incompatible one advertises nothing.
const methods = [
  "thread/read",
  "thread/resume",
  "thread/queue/list",
  "thread/queue/add",
  "thread/queue/start",
  "thread/settings/update",
  "turn/start",
];
function backendScript(compatible) {
  return (
    "#!/bin/sh\n" +
    (compatible
      ? 'if [ "$1 $2" = "app-server --help" ]; then echo "--listen --ws-auth --ws-token-file"; exit 0; fi\n' +
        'if [ "$2" = generate-json-schema ]; then printf %s \'' +
        JSON.stringify({ properties: { method: { enum: methods } } }) +
        '\' > "$5/ClientRequest.json"; exit 0; fi\n'
      : "") +
    'printf "native:%s" "$*"\n'
  );
}
function fixture({
  endpoint = "ws://127.0.0.1:1",
  profileBinary,
  compatible = true,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pokite-proxy-"));
  const app = path.join(root, "Fake.app");
  const host = path.join(app, "Contents/MacOS/host");
  const native = path.join(app, "Contents/Resources/codex-cli/bin/codex");
  fs.mkdirSync(path.dirname(host), { recursive: true });
  fs.symlinkSync(process.execPath, host);
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.writeFileSync(native, backendScript(compatible), { mode: 0o700 });
  const home = path.join(root, "codex-home");
  fs.mkdirSync(home);
  const config = path.join(root, "state/codex-shared.json");
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(
    config,
    JSON.stringify({
      profiles: {
        codex: {
          home,
          enabled: true,
          endpoint,
          binary: profileBinary ?? native,
          tokenFile: path.join(root, "state/token"),
        },
      },
    }),
  );
  const run = (args) =>
    spawnSync(
      host,
      [
        "-e",
        `const r=require("child_process").spawnSync(process.execPath,[${JSON.stringify(proxy)},...${JSON.stringify(args)}],{stdio:"inherit"});process.exit(r.status??1)`,
      ],
      {
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          CODEX_HOME: home,
          POKITE_SHARED_CONFIG: config,
          POKITE_DISABLE_NOTIFICATIONS: "1",
        },
      },
    );
  return { root, app, native, config, run };
}

test("an unresolvable saved backend falls back to the calling Desktop app's own backend", () => {
  const f = fixture({ profileBinary: "/nonexistent/codex" });
  try {
    const result = f.run(["--version"]);
    assert.equal(result.stdout, "native:--version");
    assert.equal(result.status, 0);
    const record = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(f.config), "codex-desktop-fallback.json"),
      ),
    );
    assert.match(record.reason, /not executable/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("a shared transport failure before handover runs the native backend instead of exiting", () => {
  const f = fixture({ endpoint: "ws://0.0.0.0:3999" });
  try {
    const result = f.run(["app-server", "--analytics-default-enabled"]);
    assert.equal(
      result.stdout,
      "native:app-server --analytics-default-enabled",
    );
    assert.equal(result.status, 0);
    const record = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(f.config), "codex-desktop-fallback.json"),
      ),
    );
    assert.match(record.reason, /Invalid shared endpoint/);
    // No stale lock may block the next launch.
    assert.equal(
      fs.existsSync(
        path.join(path.dirname(f.config), "codex-shared-codex.state.json.lock"),
      ),
      false,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("a live stale lock falls back to the native backend", () => {
  const f = fixture();
  try {
    fs.writeFileSync(
      path.join(path.dirname(f.config), "codex-shared-codex.state.json.lock"),
      JSON.stringify({ pid: process.pid }),
    );
    const result = f.run(["app-server"]);
    assert.equal(result.stdout, "native:app-server");
    assert.equal(result.status, 0);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("a shared backend that exits during startup falls back to the native backend", () => {
  // The fake backend exits immediately when launched as the shared server.
  const f = fixture({ endpoint: "ws://127.0.0.1:0" });
  try {
    const result = f.run(["app-server"]);
    assert.equal(result.stdout, "native:app-server");
    assert.equal(result.status, 0);
    const record = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(f.config), "codex-desktop-fallback.json"),
      ),
    );
    assert.match(record.reason, /exited during startup/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("an incompatible backend after a Desktop update skips the shared transport once per backend build", () => {
  const f = fixture({ compatible: false });
  try {
    const state = path.dirname(f.config);
    const compatFile = path.join(state, "codex-desktop-compat.json");
    const result = f.run(["app-server"]);
    assert.equal(result.stdout, "native:app-server");
    assert.equal(result.status, 0);
    const first = JSON.parse(fs.readFileSync(compatFile));
    assert.equal(first.compatible, false);
    assert.match(first.reason, /does not advertise/);
    assert.match(
      JSON.parse(
        fs.readFileSync(path.join(state, "codex-desktop-fallback.json")),
      ).reason,
      /incompatible/i,
    );
    // The same build is not probed again on the next launch.
    assert.equal(f.run(["app-server"]).stdout, "native:app-server");
    assert.equal(
      JSON.parse(fs.readFileSync(compatFile)).checkedAt,
      first.checkedAt,
    );
    // A rebuilt backend (Desktop update) is probed again.
    fs.writeFileSync(f.native, backendScript(true), { mode: 0o700 });
    f.run(["--version"]);
    f.run(["app-server"]);
    const second = JSON.parse(fs.readFileSync(compatFile));
    assert.equal(second.compatible, true);
    assert.notEqual(second.checkedAt, first.checkedAt);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
