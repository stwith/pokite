import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverMachine } from "./machine-discovery.mjs";

export const defaultInstances = () => [
  {
    id: "codex",
    provider: "codex",
    name: "Codex",
    home: path.join(os.homedir(), ".codex"),
  },
  {
    id: "dsh",
    provider: "dsh",
    name: "DeepSeek Harness",
    url: process.env.DSH_URL || "http://127.0.0.1:3080",
  },
  {
    id: "penguin",
    provider: "penguin",
    name: "PenguinHarness",
    home: os.homedir(),
  },
  {
    id: "claude",
    provider: "claude",
    name: "Claude Code",
    home: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
  },
  {
    id: "claudeDesktop",
    provider: "claudeDesktop",
    name: "Claude Desktop",
    home: path.join(os.homedir(), "Library/Application Support/Claude"),
  },
];
export function validateInstances(value) {
  if (!Array.isArray(value) || value.length > 20)
    throw Error("instances must be an array with at most 20 entries");
  const ids = new Set();
  const providers = new Set(defaultInstances().map((x) => x.provider));
  if (value.some((x) => !x || typeof x !== "object" || Array.isArray(x)))
    throw Error("Invalid instance entry");
  return value
    .filter((x) => x.enabled !== false)
    .map((x) => {
      if (
        !/^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/.test(x.id || "") ||
        ["constructor", "__proto__", "prototype"].includes(x.id) ||
        ids.has(x.id)
      )
        throw Error("Invalid or duplicate instance id");
      if (!providers.has(x.provider))
        throw Error("Unsupported provider: " + x.provider);
      if (typeof x.name !== "string" || !x.name.trim() || x.name.length > 80)
        throw Error("Invalid instance name");
      ids.add(x.id);
      const defaults = defaultInstances().find(
        (d) => d.provider === x.provider,
      );
      const instance = { ...defaults, ...x };
      if (instance.home) {
        if (typeof instance.home !== "string")
          throw Error("Invalid instance home");
        instance.home = instance.home.replace(/^~(?=\/|$)/, os.homedir());
        if (!path.isAbsolute(instance.home))
          throw Error("Instance home must be absolute");
        if (
          x.provider === "claude" &&
          path.resolve(instance.home) !== path.resolve(defaults.home)
        )
          throw Error(
            "Claude SDK history uses the service CLAUDE_CONFIG_DIR; configure it before launch instead of mixing Claude homes",
          );
      }
      if (instance.url) {
        const url = new URL(instance.url);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw Error("Invalid agent URL");
        instance.url = url.href.replace(/\/$/, "");
      }
      return instance;
    });
}
export function loadInstances(file) {
  const explicit =
    arguments.length > 0 || process.env.POCKET_CONFIG !== undefined;
  const defaultFile = new URL("../.local/instances.json", import.meta.url);
  file ??= process.env.POCKET_CONFIG ?? defaultFile;
  if (typeof file === "string" && !file.trim())
    throw Error("Specified instance configuration path is empty");
  if (!fs.existsSync(file)) {
    if (explicit)
      throw Error(
        "Specified instance configuration does not exist: " + String(file),
      );
    return validateInstances(discoverMachine().instances);
  }
  return validateInstances(JSON.parse(fs.readFileSync(file, "utf8")).instances);
}

export function capabilities(adapter) {
  const writable = !adapter.readOnly && !!adapter.send;
  return {
    read: true,
    connect: typeof adapter.connect === "function",
    create: writable && !!adapter.create,
    reply: writable,
    approvals: writable && !!adapter.answer,
    modelSelection: writable && !!adapter.models,
    localWithdraw: writable,
    nativeWithdraw: false,
    concurrentReply:
      writable && adapter.provider === "codex" && !!adapter.control,
  };
}
