import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { codexDatabasePath } from "./codex-store.mjs";

const exists = (file) => {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
};
const executable = (file) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};
const entries = (directory) => {
  try {
    return fs.readdirSync(directory).sort();
  } catch {
    return [];
  }
};
const expand = (value, home) => path.resolve(value.replace(/^~(?=\/|$)/, home));
export function findExecutable(
  name,
  { explicit, home = os.homedir(), env = process.env } = {},
) {
  if (explicit) {
    const file = expand(explicit, home);
    if (!executable(file))
      throw Error("Configured executable is not executable: " + file);
    return file;
  }
  const roots = [
    ...(env.PATH || "").split(path.delimiter).filter(Boolean),
    path.dirname(process.execPath),
    path.join(home, ".local/bin"),
    path.join(home, "bin"),
    path.join(home, ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
  for (const root of new Set(roots)) {
    const file = path.join(root, name);
    if (executable(file)) return path.resolve(file);
  }
  return null;
}
function processRows(field) {
  try {
    return execFileSync("/bin/ps", ["-ww", "-axo", field + "="], {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 2 * 1024 * 1024,
    })
      .split("\n")
      .map((x) => x.trim());
  } catch {
    return [];
  }
}
export function discoverDesktopApps({
  home = os.homedir(),
  appRoots = ["/Applications", path.join(home, "Applications")],
  running = processRows("comm"),
  explicitApp,
} = {}) {
  const candidates = new Set(explicitApp ? [expand(explicitApp, home)] : []);
  for (const root of appRoots)
    for (const name of entries(root)
      .filter((x) => x.endsWith(".app"))
      .slice(0, 300))
      candidates.add(path.join(root, name));
  for (const file of running) {
    const end = file.indexOf(".app/Contents/");
    if (end >= 0) candidates.add(file.slice(0, end + 4));
  }
  const apps = [];
  for (const app of candidates) {
    const binary = path.join(app, "Contents/Resources/codex");
    const isCodex = executable(binary);
    if (!isCodex && !/claude|penguin/i.test(path.basename(app))) continue;
    let info = {};
    const plist = path.join(app, "Contents/Info.plist");
    try {
      info = JSON.parse(fs.readFileSync(plist, "utf8"));
    } catch {
      if (process.platform === "darwin" && exists(plist))
        try {
          info = JSON.parse(
            execFileSync(
              "/usr/bin/plutil",
              ["-convert", "json", "-o", "-", plist],
              { encoding: "utf8", timeout: 1500 },
            ),
          );
        } catch {}
    }
    if (
      isCodex &&
      !/^com\.openai\.codex(?:[.-]|$)/.test(info.CFBundleIdentifier || "")
    )
      continue;
    if (
      !isCodex &&
      ![
        "com.anthropic.claudefordesktop",
        "com.prismshadow.penguinharness",
      ].includes(info.CFBundleIdentifier)
    )
      continue;
    apps.push({
      provider: isCodex
        ? "codex"
        : info.CFBundleIdentifier === "com.anthropic.claudefordesktop"
          ? "claudeDesktop"
          : "penguin",
      app,
      binary: isCodex ? binary : null,
      appExecutable: info.CFBundleExecutable
        ? path.join(app, "Contents/MacOS", info.CFBundleExecutable)
        : null,
      bundleId: info.CFBundleIdentifier || null,
      version: info.CFBundleShortVersionString || null,
      running: running.some((file) => file.startsWith(app + "/Contents/")),
    });
  }
  return apps;
}
export function resolveCodexDesktopBinary({
  explicit,
  apps,
  parentExecutable,
  ...options
} = {}) {
  if (explicit) return findExecutable("codex", { ...options, explicit });
  const candidates = (apps || discoverDesktopApps(options)).filter(
    (app) => app.provider === "codex",
  );
  if (parentExecutable) {
    const parent = candidates.find((app) =>
      parentExecutable.startsWith(app.app + "/Contents/"),
    );
    if (parent) return parent.binary;
  }
  const running = candidates.filter((app) => app.running);
  if (running.length === 1) return running[0].binary;
  if (candidates.length === 1) return candidates[0].binary;
  throw Error(
    candidates.length
      ? "Multiple Codex Desktop installations found; select a binary explicitly"
      : "Codex Desktop bundled backend not found; configure its actual executable path",
  );
}
function savedProfiles(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).profiles || {};
  } catch {
    return {};
  }
}
export function discoverMachine({
  home = os.homedir(),
  env = process.env,
  appRoots,
  running,
  commands,
  sharedFile = env.POCKET_SHARED_CONFIG ||
    new URL("../.local/codex-shared.json", import.meta.url),
  sharedProfiles = savedProfiles(sharedFile),
} = {}) {
  const apps = discoverDesktopApps({
    home,
    appRoots,
    running,
    explicitApp: env.POCKET_CODEX_APP,
  });
  const tools = Object.fromEntries(
    ["codex", "claude", "dsh", "penguin"].map((name) => [
      name,
      findExecutable(name, { home, env }),
    ]),
  );
  const candidates = [],
    instances = [],
    seenHomes = new Set();
  const homes = [
    ...Object.values(sharedProfiles).map((x) => x.home),
    env.CODEX_HOME,
    ...entries(home)
      .filter((x) => /^\.codex(?:[-_][\w-]+)?$/.test(x))
      .slice(0, 40)
      .map((x) => path.join(home, x)),
  ].filter(Boolean);
  for (const candidate of homes) {
    const directory = expand(candidate, home);
    let identity = directory;
    try {
      identity = fs.realpathSync(directory);
    } catch {}
    if (seenHomes.has(identity)) continue;
    seenHomes.add(identity);
    const nativeHistory = !!codexDatabasePath(directory);
    if (!nativeHistory && !exists(path.join(directory, "config.toml")))
      continue;
    const old = Object.entries(sharedProfiles).find(
      ([, p]) => path.resolve(p.home) === directory,
    );
    const base = path.basename(directory);
    const id =
      old?.[0] ||
      (base === ".codex"
        ? "codex"
        : base === ".codex-2"
          ? "codex2"
          : "codex-" +
            createHash("sha256").update(directory).digest("hex").slice(0, 8));
    const instance = {
      id,
      provider: "codex",
      name:
        id === "codex"
          ? "Codex"
          : id === "codex2"
            ? "Codex 2"
            : "Codex (" + base + ")",
      home: directory,
    };
    candidates.push({
      ...instance,
      cliInstalled: !!tools.codex,
      desktopInstalled: apps.some((x) => x.provider === "codex"),
      nativeHistory,
      integration: "shared-desktop",
      status: nativeHistory
        ? old?.[1].enabled
          ? "sharing-configured"
          : "needs-desktop-connection"
        : "no-native-history",
    });
    if (nativeHistory) instances.push(instance);
  }
  // Inspect only DSH web command shape/port. Never emit raw process arguments.
  const urls = new Set(env.DSH_URL ? [env.DSH_URL] : []);
  for (const command of commands || processRows("command")) {
    const direct = /^(?:\S*\/)?dsh\s+web(?:\s|$)/.test(command);
    const node =
      /^(?:\S*\/)?(?:node|bun)\s+(?:--[\w=-]+\s+)*(\S+)\s+web(?:\s|$)/.exec(
        command,
      );
    if (
      !direct &&
      !(
        node &&
        (node[1].endsWith("/dsh") || node[1].includes("@deepseek-ai/dsh/"))
      )
    )
      continue;
    const port = Number(command.match(/--port(?:=|\s+)(\d+)/)?.[1] || 3080);
    if (port > 0 && port < 65536) urls.add("http://127.0.0.1:" + port);
  }
  if (urls.size) {
    [...urls].sort().forEach((url, index) => {
      const instance = {
        id: index
          ? "dsh-" + createHash("sha256").update(url).digest("hex").slice(0, 8)
          : "dsh",
        provider: "dsh",
        name: index
          ? "DeepSeek Harness (" + new URL(url).port + ")"
          : "DeepSeek Harness",
        url,
      };
      candidates.push({
        ...instance,
        cliInstalled: !!tools.dsh,
        integration: "existing-service",
        status: "endpoint-discovered",
      });
      instances.push(instance);
    });
  } else if (tools.dsh || exists(path.join(home, ".dsh")))
    candidates.push({
      provider: "dsh",
      cliInstalled: !!tools.dsh,
      integration: "existing-service",
      status: "web-service-not-found",
    });
  if (exists(path.join(home, ".penguin/data"))) {
    const instance = {
      id: "penguin",
      provider: "penguin",
      name: "PenguinHarness",
      home,
    };
    candidates.push({
      ...instance,
      integration: "existing-service",
      status: exists(path.join(home, ".penguin/data/server.lock"))
        ? "service-record-found"
        : "service-not-running",
    });
    instances.push(instance);
  }
  const claudeHome = expand(
    env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
    home,
  );
  if (exists(path.join(claudeHome, "projects"))) {
    const instance = {
      id: "claude",
      provider: "claude",
      name: "Claude Code",
      home: claudeHome,
    };
    candidates.push({
      ...instance,
      cliInstalled: !!tools.claude,
      integration: "sdk-session-not-desktop-sharing",
      status: "native-history-found",
    });
    instances.push(instance);
  }
  const desktopHome = path.join(home, "Library/Application Support/Claude");
  const hermesHome = expand(
    env.HERMES_HOME || path.join(home, ".hermes"),
    home,
  );
  if (
    exists(path.join(hermesHome, "state.db")) &&
    exists(path.join(home, "Library/Application Support/Hermes"))
  ) {
    const instance = {
      id: "hermesDesktop",
      provider: "hermesDesktop",
      name: "Hermes Desktop",
      home: hermesHome,
    };
    instances.push(instance);
    candidates.push({
      ...instance,
      integration: "desktop-shared-backend",
      status: "desktop-history-found",
    });
  }
  if (
    ["claude-code-sessions", "local-agent-mode-sessions"].some((name) =>
      exists(path.join(desktopHome, name)),
    )
  ) {
    const instance = {
      id: "claudeDesktop",
      provider: "claudeDesktop",
      name: "Claude Desktop",
      home: desktopHome,
    };
    candidates.push({
      ...instance,
      integration: "desktop-history-only",
      status: "read-only",
    });
    instances.push(instance);
  }
  return {
    platform: process.platform,
    node: process.execPath,
    apps,
    tools,
    candidates,
    instances,
  };
}
