import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolveCodexDesktopBinary } from "./machine-discovery.mjs";

export function probeDesktopTransport(binary) {
  const options = { encoding: "utf8", timeout: 5000, maxBuffer: 128 * 1024 };
  const version = execFileSync(binary, ["--version"], options).trim();
  const help = execFileSync(binary, ["app-server", "--help"], options);
  const supported = ["--listen", "--ws-auth", "--ws-token-file"].every((flag) =>
    help.includes(flag),
  );
  if (!supported)
    throw Error(
      "This Desktop backend does not advertise the required authenticated transport",
    );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-protocol-"));
  const required = [
    "thread/read",
    "thread/resume",
    "thread/queue/list",
    "thread/queue/add",
    "thread/queue/start",
    "thread/settings/update",
    "turn/start",
  ];
  try {
    execFileSync(
      binary,
      [
        "app-server",
        "generate-json-schema",
        "--experimental",
        "--out",
        directory,
      ],
      options,
    );
    const schema = JSON.parse(
      fs.readFileSync(path.join(directory, "ClientRequest.json"), "utf8"),
    );
    const methods = new Set();
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      const method = value.properties?.method;
      if (typeof method?.const === "string") methods.add(method.const);
      for (const name of method?.enum || []) methods.add(name);
      for (const child of Object.values(value)) visit(child);
    };
    visit(schema);
    const missing = required.filter((method) => !methods.has(method));
    if (missing.length)
      throw Error(
        "Desktop protocol is missing required methods: " + missing.join(", "),
      );
    return {
      version,
      transportSupported: true,
      requiredMethodsPresent: true,
      concurrentDesktopBehavior: "requires isolated verification",
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
export async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export function renderDesktopLauncher(node, proxy, config) {
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  return (
    "#!/bin/sh\nexport POCKET_SHARED_CONFIG=" +
    quote(config) +
    "\nexec " +
    quote(node) +
    " " +
    quote(proxy) +
    ' "$@"\n'
  );
}
export async function prepareSharing({
  instances,
  local,
  previous = {},
  binary,
  overrideBinary = false,
  port = availablePort,
}) {
  const profiles = { ...(previous.profiles || {}) },
    used = new Set(
      Object.values(profiles).map(
        (p) => p.endpoint && new URL(p.endpoint).port,
      ),
    );
  for (const instance of instances.filter((x) => x.provider === "codex")) {
    const old = profiles[instance.id];
    if (old && path.resolve(old.home) !== path.resolve(instance.home))
      throw Error(
        "Refusing to repoint an existing shared profile: " + instance.id,
      );
    let endpoint = old?.endpoint;
    if (!endpoint) {
      let selected;
      for (let attempt = 0; attempt < 20; attempt++) {
        selected = await port();
        if (!used.has(String(selected))) break;
        selected = null;
      }
      if (!selected) throw Error("Could not allocate distinct shared ports");
      used.add(String(selected));
      endpoint = "ws://127.0.0.1:" + selected;
    }
    const parsed = new URL(endpoint);
    if (
      parsed.protocol !== "ws:" ||
      parsed.hostname !== "127.0.0.1" ||
      !parsed.port
    )
      throw Error(
        "Shared endpoints must stay on loopback with an explicit port",
      );
    const selectedBinary = resolveCodexDesktopBinary({
      explicit: overrideBinary
        ? binary
        : instance.desktopBinary || old?.binary || binary,
    });
    profiles[instance.id] = {
      ...old,
      home: instance.home,
      endpoint,
      binary: selectedBinary,
      tokenFile:
        old?.tokenFile ||
        path.join(local, "codex-shared-" + instance.id + ".token"),
      stateFile:
        old?.stateFile ||
        path.join(local, "codex-shared-" + instance.id + ".state.json"),
      enabled: old?.enabled === true,
    };
  }
  return { ...previous, profiles };
}
export function readSharingConfig(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { profiles: {} };
    throw error;
  }
}
export async function withFileRollback(files, work) {
  const snapshots = files.map((file) => {
    try {
      return {
        file,
        bytes: fs.readFileSync(file),
        mode: fs.statSync(file).mode & 0o777,
      };
    } catch (error) {
      if (error.code === "ENOENT") return { file };
      throw error;
    }
  });
  try {
    return await work();
  } catch (error) {
    const failures = [];
    for (const snapshot of snapshots)
      try {
        if (!snapshot.bytes) fs.rmSync(snapshot.file, { force: true });
        else {
          const temporary = snapshot.file + "." + randomUUID() + ".restore";
          fs.writeFileSync(temporary, snapshot.bytes, { mode: snapshot.mode });
          fs.renameSync(temporary, snapshot.file);
        }
      } catch (restoreError) {
        failures.push(restoreError);
      }
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        "Setup failed and file restoration was incomplete; inspect the saved backup",
      );
    throw error;
  }
}
export async function withSetupLock(configFile, expected, work) {
  const file = configFile + ".setup.lock";
  let fd;
  try {
    fd = fs.openSync(file, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error(
        "Sharing setup is already running or left a stale setup lock",
      );
    throw error;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    if (
      JSON.stringify(readSharingConfig(configFile)) !== JSON.stringify(expected)
    )
      throw Error(
        "Sharing configuration changed during discovery; rerun setup",
      );
    return await work();
  } finally {
    const identity = fs.fstatSync(fd);
    fs.closeSync(fd);
    try {
      if (fs.statSync(file).ino === identity.ino) fs.unlinkSync(file);
    } catch {}
  }
}
