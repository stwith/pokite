import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadInstances } from "../server/instances.mjs";
import { CodexReadOnly } from "../server/codex-readonly.mjs";
import { resolveCodexDesktopBinary } from "../server/machine-discovery.mjs";
import {
  prepareSharing,
  probeDesktopTransport,
  readSharingConfig,
  renderDesktopLauncher,
  withFileRollback,
  withSetupLock,
} from "../server/sharing-setup.mjs";

const { values } = parseArgs({
  options: {
    enable: { type: "boolean" },
    disable: { type: "boolean" },
    "dry-run": { type: "boolean" },
    binary: { type: "string" },
    instance: { type: "string", multiple: true },
  },
});
if (values.enable && values.disable) throw Error("Choose enable or disable");
if (process.platform !== "darwin")
  throw Error("Desktop sharing setup is currently verified on macOS only");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".local");
const configFile =
  process.env.POCKET_SHARED_CONFIG || path.join(local, "codex-shared.json");
const proxy = path.join(root, "scripts/codex-desktop-proxy.mjs");
const launcher = path.join(local, "codex-desktop-launcher");
const agentFile = path.join(
  process.env.HOME,
  "Library/LaunchAgents/local.agent-pocket.codex-sharing.plist",
);
const previous = readSharingConfig(configFile);
const instances = loadInstances().filter(
  (instance) => !values.instance || values.instance.includes(instance.id),
);
if (
  values.instance?.some(
    (id) =>
      !instances.some((instance) => instance.id === id) &&
      !(values.disable && Object.hasOwn(previous.profiles || {}, id)),
  )
)
  throw Error("Unknown selected instance");
let config, compatibility;
if (values.disable) {
  config = structuredClone(previous);
} else {
  if (!instances.some((instance) => instance.provider === "codex"))
    throw Error("No readable Codex Desktop profiles found");
  for (const instance of instances.filter((x) => x.provider === "codex")) {
    const reader = new CodexReadOnly(instance.home);
    try {
      reader.database();
    } finally {
      reader.close();
    }
  }
  const explicit = values.binary || process.env.POCKET_CODEX_DESKTOP_BIN;
  const needsDefault = instances.some(
    (x) =>
      x.provider === "codex" &&
      !x.desktopBinary &&
      !previous.profiles?.[x.id]?.binary,
  );
  const binary =
    explicit || needsDefault
      ? resolveCodexDesktopBinary({ explicit })
      : undefined;
  config = await prepareSharing({
    instances,
    local,
    previous,
    binary,
    overrideBinary: !!explicit,
  });
  compatibility = [
    ...new Set(
      instances
        .filter((x) => x.provider === "codex")
        .map((x) => config.profiles[x.id].binary),
    ),
  ].map((binary) => ({ binary, ...probeDesktopTransport(binary) }));
}
for (const [id, profile] of Object.entries(config.profiles)) {
  if (values.instance && !values.instance.includes(id)) continue;
  if (
    values.enable &&
    !instances.some(
      (instance) => instance.id === id && instance.provider === "codex",
    )
  )
    continue;
  if (values.enable) profile.enabled = true;
  if (values.disable) profile.enabled = false;
}
let previousEnv = null;
try {
  previousEnv =
    execFileSync("/bin/launchctl", ["getenv", "CODEX_CLI_PATH"], {
      encoding: "utf8",
    }).trim() || null;
} catch {}
const conflict = previousEnv && ![proxy, launcher].includes(previousEnv);
const plan = {
  action: values.disable ? "disable" : values.enable ? "enable" : "prepare",
  dryRun: !!values["dry-run"],
  launcher,
  node: process.execPath,
  compatibility,
  profiles: Object.entries(config.profiles).map(([id, profile]) => ({
    id,
    home: profile.home,
    endpoint: profile.endpoint,
    binary: profile.binary,
    enabled: profile.enabled,
  })),
  environmentConflict: !!conflict,
  note: "No Desktop processes are restarted. Readiness and native queue compatibility are separate checks.",
};
if (values["dry-run"]) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  if ((values.enable || values.disable) && conflict)
    throw Error(
      "An unrelated CODEX_CLI_PATH is set; disable/review that integration before changing it",
    );
  await fs.mkdir(local, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 });
  await withSetupLock(configFile, previous, async () => {
    const backup = path.join(
      local,
      "sharing-backups",
      new Date().toISOString().replaceAll(":", "-"),
    );
    await fs.mkdir(backup, { recursive: true, mode: 0o700 });
    for (const [source, name] of [
      [configFile, "codex-shared.json"],
      [agentFile, "launch-agent.plist"],
      [launcher, "launcher"],
    ]) {
      try {
        await fs.copyFile(source, path.join(backup, name));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await fs.writeFile(
      path.join(backup, "environment.json"),
      JSON.stringify({ CODEX_CLI_PATH: previousEnv }),
      { mode: 0o600 },
    );
    try {
      await withFileRollback([configFile, launcher, agentFile], async () => {
        await fs.writeFile(
          configFile + ".tmp",
          JSON.stringify(config, null, 2),
          {
            mode: 0o600,
          },
        );
        await fs.rename(configFile + ".tmp", configFile);
        await fs.writeFile(
          launcher,
          renderDesktopLauncher(
            process.execPath,
            proxy,
            path.resolve(configFile),
          ),
          { mode: 0o700 },
        );
        await fs.chmod(launcher, 0o700);
        if (values.enable) {
          const plist = {
            Label: "local.agent-pocket.codex-sharing",
            ProgramArguments: [
              "/bin/launchctl",
              "setenv",
              "CODEX_CLI_PATH",
              launcher,
            ],
            RunAtLoad: true,
          };
          const xml = execFileSync(
            "/usr/bin/plutil",
            ["-convert", "xml1", "-o", "-", "-"],
            { input: JSON.stringify(plist), encoding: "utf8" },
          );
          await fs.mkdir(path.dirname(agentFile), { recursive: true });
          await fs.writeFile(agentFile, xml, { mode: 0o600 });
          execFileSync("/bin/launchctl", [
            "setenv",
            "CODEX_CLI_PATH",
            launcher,
          ]);
        } else if (
          values.disable &&
          !Object.values(config.profiles).some((profile) => profile.enabled)
        ) {
          try {
            execFileSync(
              "/bin/launchctl",
              [
                "bootout",
                "gui/" + process.getuid() + "/local.agent-pocket.codex-sharing",
              ],
              { stdio: "ignore" },
            );
          } catch {}
          if ([proxy, launcher].includes(previousEnv))
            execFileSync("/bin/launchctl", ["unsetenv", "CODEX_CLI_PATH"]);
          await fs.rm(agentFile, { force: true });
        }
      });
    } catch (error) {
      if (values.enable || values.disable) {
        try {
          execFileSync(
            "/bin/launchctl",
            previousEnv
              ? ["setenv", "CODEX_CLI_PATH", previousEnv]
              : ["unsetenv", "CODEX_CLI_PATH"],
          );
        } catch {
          throw new AggregateError(
            [error],
            "Setup failed; environment restoration needs inspection. Backup: " +
              backup,
          );
        }
      }
      throw error;
    }
    console.log(
      JSON.stringify(
        {
          ...plan,
          backup,
          restartRequired: !!(values.enable || values.disable),
        },
        null,
        2,
      ),
    );
  });
}
