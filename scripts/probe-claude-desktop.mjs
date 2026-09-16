import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  decryptDesktopCache,
  sessionCredential,
  readSessionProbe,
} from "./lib/claude-desktop-probe.mjs";
import { macHttpsProxy, verifyDesktopNetwork } from "./lib/desktop-network.mjs";

try {
  if (process.argv.includes("--system-proxy")) {
    if (process.platform !== "darwin")
      throw Error("System proxy discovery supports macOS only");
    const { stdout } = await promisify(execFile)(
      "/usr/sbin/scutil",
      ["--proxy"],
      { encoding: "utf8" },
    );
    const proxy = macHttpsProxy(stdout);
    if (!proxy) throw Error("No enabled static macOS HTTPS proxy found");
    if (!process.allowedNodeEnvironmentFlags.has("--use-env-proxy"))
      throw Error(
        "This diagnostic requires a Node version supporting --use-env-proxy",
      );
    const child = spawn(
      process.execPath,
      [
        "--use-env-proxy",
        process.argv[1],
        ...process.argv.slice(2).filter((a) => a !== "--system-proxy"),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          HTTPS_PROXY: proxy,
          https_proxy: proxy,
          NO_PROXY: "127.0.0.1,localhost,::1",
          no_proxy: "127.0.0.1,localhost,::1",
        },
      },
    );
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    process.exit(code);
  }
  console.log(JSON.stringify(await verifyDesktopNetwork()));
  if (process.argv.includes("--network-only")) process.exit(0);
  if (!process.argv.includes("--keychain"))
    throw Error(
      "Use --keychain to explicitly request the macOS keychain diagnostic",
    );
  if (process.platform !== "darwin")
    throw Error("This diagnostic supports macOS only");
  const root = path.join(
    process.env.HOME,
    "Library/Application Support/Claude",
  );
  const config = JSON.parse(
    await fs.readFile(path.join(root, "config.json"), "utf8"),
  );
  const account = config.lastKnownAccountUuid;
  if (typeof account !== "string" || !/^[a-zA-Z0-9_-]+$/.test(account))
    throw Error("Desktop account unavailable");
  const orgs = new Set();
  for (const kind of ["claude-code-sessions", "local-agent-mode-sessions"]) {
    for (const entry of await fs
      .readdir(path.join(root, kind, account), { withFileTypes: true })
      .catch(() => [])) {
      if (entry.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(entry.name))
        orgs.add(entry.name);
    }
  }
  if (orgs.size !== 1)
    throw Error("Desktop organization is absent or ambiguous");
  console.log(
    "Waiting for macOS keychain authorization; credentials stay in this process only.",
  );
  let password;
  try {
    const { stdout } = await promisify(execFile)(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        "Claude Safe Storage",
        "-a",
        "Claude",
        "-w",
      ],
      { timeout: 120000, maxBuffer: 16384, encoding: "buffer" },
    );
    password = stdout;
  } catch {
    throw Error("macOS keychain authorization unavailable or timed out");
  }
  try {
    const end = password.at(-1) === 10 ? password.length - 1 : password.length;
    const cache = decryptDesktopCache(
      config["oauth:tokenCacheV2"] || config["oauth:tokenCache"],
      password.subarray(0, end),
    );
    const current = JSON.parse(
      await fs.readFile(path.join(root, "config.json"), "utf8"),
    );
    if (current.lastKnownAccountUuid !== account)
      throw Error("Desktop account changed during authorization");
    const organization = [...orgs][0];
    const associations = await fs
      .readFile(
        path.join(
          root,
          "local-agent-mode-sessions",
          account,
          organization,
          "remote-session-spaces.json",
        ),
        "utf8",
      )
      .then(JSON.parse)
      .catch(() => null);
    const expectedIds = (
      Array.isArray(associations?.entries) ? associations.entries : []
    ).map((e) => e?.sessionId);
    const token = sessionCredential(cache, account, organization);
    const selectedKey = Object.entries(cache).find(
      ([key, value]) =>
        key.startsWith(`acct:${account}|`) && value?.token === token,
    )?.[0];
    const profileScopeDeclared =
      selectedKey
        ?.split(":https://api.anthropic.com:")[1]
        ?.split(" ")
        .includes("user:profile") === true;
    console.log(JSON.stringify({ profileScopeDeclared }));
    if (!profileScopeDeclared)
      throw Error(
        "Selected session credential has no declared user:profile scope; profile-first validation cannot proceed",
      );
    console.log(
      JSON.stringify(
        await readSessionProbe(
          token,
          account,
          organization,
          fetch,
          expectedIds,
        ),
      ),
    );
  } finally {
    password.fill(0);
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Desktop diagnostic failed",
  );
  process.exitCode = 1;
}
