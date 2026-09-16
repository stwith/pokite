import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  discoverMachine,
  discoverDesktopApps,
  findExecutable,
  resolveCodexDesktopBinary,
} from "../server/machine-discovery.mjs";
import {
  prepareSharing,
  renderDesktopLauncher,
  withFileRollback,
  withSetupLock,
} from "../server/sharing-setup.mjs";
import { codexDatabasePath } from "../server/codex-store.mjs";
import { CodexReadOnly } from "../server/codex-readonly.mjs";
import { DatabaseSync } from "node:sqlite";

function file(name, text = "", mode = 0o600) {
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, text, { mode });
}
test("discovery handles moved bundles, extra profiles and false CLI text without running agents", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-discovery-"));
  try {
    const home = path.join(root, "home"),
      app = path.join(root, "Portable Apps", "Work Tools.app"),
      binary = path.join(app, "Contents/Resources/codex");
    file(binary, "#!/bin/sh\nexit 99\n", 0o700);
    file(
      path.join(app, "Contents/Info.plist"),
      JSON.stringify({
        CFBundleIdentifier: "com.openai.codex",
        CFBundleExecutable: "Codex",
        CFBundleShortVersionString: "fixture",
      }),
    );
    for (const name of [".codex", ".codex-2", ".codex-work"])
      file(path.join(home, name, "state_9.sqlite"));
    file(
      path.join(home, ".codex-work", "auth.json"),
      "not valid JSON and must not be read",
    );
    const report = discoverMachine({
      home,
      env: { PATH: "" },
      appRoots: [],
      running: [path.join(app, "Contents/MacOS/Codex")],
      commands: [
        "/runtime/node /cache/node_modules/.bin/dsh web --port 45123",
        '/runtime/node /tools/claude --print "dsh web --port 1234"',
      ],
      sharedProfiles: {
        office: { home: path.join(home, ".codex-work"), enabled: true },
      },
    });
    assert.equal(report.apps[0].binary, binary);
    assert.deepEqual(
      report.instances
        .filter((x) => x.provider === "codex")
        .map((x) => x.id)
        .sort(),
      ["codex", "codex2", "office"],
    );
    assert.equal(
      report.instances.find((x) => x.provider === "dsh").url,
      "http://127.0.0.1:45123",
    );
    assert.equal(JSON.stringify(report).includes("not valid JSON"), false);
    assert.equal(resolveCodexDesktopBinary({ apps: report.apps }), binary);
    assert.equal(
      codexDatabasePath(path.join(home, ".codex")),
      path.join(home, ".codex/state_9.sqlite"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("CLI-only evidence does not claim Desktop sharing and unrelated URL handlers are excluded", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pocket-empty-discovery-"),
  );
  try {
    const bin = path.join(root, "bin");
    file(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", 0o700);
    const apps = path.join(root, "Applications");
    file(
      path.join(apps, "Claude URL Handler.app/Contents/Info.plist"),
      JSON.stringify({
        CFBundleIdentifier: "com.anthropic.claude-code-url-handler",
      }),
    );
    const report = discoverMachine({
      home: root,
      env: { PATH: bin },
      appRoots: [apps],
      running: [],
      commands: [],
      sharedProfiles: {},
    });
    assert.equal(report.tools.codex, path.join(bin, "codex"));
    assert.deepEqual(report.apps, []);
    assert.deepEqual(report.instances, []);
    assert.throws(
      () =>
        findExecutable("codex", {
          explicit: path.join(root, "missing"),
          env: { PATH: bin },
        }),
      /not executable/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("ambiguous Desktop installs require a choice; parent bundle selects the matching backend", () => {
  const apps = [
    {
      provider: "codex",
      app: "/one.app",
      binary: "/one.app/core",
      running: false,
    },
    {
      provider: "codex",
      app: "/two.app",
      binary: "/two.app/core",
      running: false,
    },
  ];
  assert.throws(() => resolveCodexDesktopBinary({ apps }), /Multiple/);
  assert.equal(
    resolveCodexDesktopBinary({
      apps,
      parentExecutable: "/two.app/Contents/MacOS/App",
    }),
    "/two.app/core",
  );
});
test("sharing preparation preserves active identity and assigns only new ports", async () => {
  const previous = {
    profiles: {
      work: {
        home: "/tmp/work",
        endpoint: "ws://127.0.0.1:41111",
        enabled: true,
        tokenFile: "/tmp/original.token",
        stateFile: "/tmp/original.state",
      },
    },
  };
  const plan = await prepareSharing({
    instances: [
      { id: "work", provider: "codex", home: "/tmp/work" },
      { id: "other", provider: "codex", home: "/tmp/other" },
    ],
    local: "/tmp/private",
    previous,
    binary: process.execPath,
    port: async () => 42222,
  });
  assert.equal(plan.profiles.work.endpoint, previous.profiles.work.endpoint);
  assert.equal(plan.profiles.work.tokenFile, "/tmp/original.token");
  assert.equal(plan.profiles.work.enabled, true);
  assert.equal(plan.profiles.other.endpoint, "ws://127.0.0.1:42222");
  assert.equal(plan.profiles.other.enabled, false);
  await assert.rejects(
    prepareSharing({
      instances: [{ id: "work", provider: "codex", home: "/tmp/wrong" }],
      previous,
      binary: process.execPath,
      local: "/tmp",
    }),
    /repoint/,
  );
});
test("generated launcher supports spaces and quotes without shell interpolation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-launcher-"));
  try {
    const proxy = path.join(root, "a 'quoted folder", "proxy.mjs"),
      config = path.join(root, "my 'config.json"),
      launcher = path.join(root, "launcher");
    file(
      proxy,
      "console.log(JSON.stringify({args:process.argv.slice(2),config:process.env.POCKET_SHARED_CONFIG}));",
    );
    file(
      launcher,
      renderDesktopLauncher(process.execPath, proxy, config),
      0o700,
    );
    const result = JSON.parse(
      execFileSync(launcher, ["a b", "$(touch unexpected-file)"], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    assert.deepEqual(result, {
      args: ["a b", "$(touch unexpected-file)"],
      config,
    });
    assert.equal(fs.existsSync(path.join(root, "unexpected-file")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("setup file mutations roll back on failure without discarding the prior configuration", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-setup-rollback-"));
  try {
    const config = path.join(root, "config.json"),
      launcher = path.join(root, "launcher");
    file(config, "original");
    await assert.rejects(
      withFileRollback([config, launcher], async () => {
        fs.writeFileSync(config, "changed");
        fs.writeFileSync(launcher, "new");
        throw Error("simulated launch setup failure");
      }),
      /simulated/,
    );
    assert.equal(fs.readFileSync(config, "utf8"), "original");
    assert.equal(fs.existsSync(launcher), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("stale setup plans cannot overwrite a changed configuration", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-setup-lock-"));
  try {
    const config = path.join(root, "config.json");
    file(config, JSON.stringify({ profiles: {}, changed: true }));
    await assert.rejects(
      withSetupLock(config, { profiles: {} }, async () => {
        throw Error("must not run");
      }),
      /changed during discovery/,
    );
    assert.equal(JSON.parse(fs.readFileSync(config)).changed, true);
    assert.equal(fs.existsSync(config + ".setup.lock"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("a newer incompatible native store is not replaced with an older snapshot", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-store-version-"));
  try {
    const old = new DatabaseSync(path.join(root, "state_5.sqlite"));
    old.exec(
      "CREATE TABLE threads(id,rollout_path,updated_at_ms,project_id,archived,source); CREATE TABLE projects(id,name,position); CREATE TABLE project_roots(project_id,path,position);",
    );
    old.close();
    const newer = new DatabaseSync(path.join(root, "state_6.sqlite"));
    newer.exec("CREATE TABLE unsupported(id)");
    newer.close();
    const reader = new CodexReadOnly(root);
    await assert.rejects(reader.call("thread/list"), { status: 503 });
    assert.equal(reader.db, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
