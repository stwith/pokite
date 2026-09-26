import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "pokite-native-broker-"),
);
try {
  const binary = path.join(directory, "broker");
  execFileSync(
    "/usr/bin/xcrun",
    [
      "swiftc",
      "-swift-version",
      "5",
      "-O",
      fileURLToPath(
        new URL("../native/claude-session-broker.swift", import.meta.url),
      ),
      "-o",
      binary,
    ],
    { stdio: "pipe", timeout: 90000 },
  );
  console.log(
    execFileSync(binary, ["--self-test"], {
      encoding: "utf8",
      timeout: 10000,
    }).trim(),
  );
  // Invalid commands must be rejected without showing a keychain prompt.
  const result = execFileSync(binary, [], {
    input:
      JSON.stringify({
        id: "fixture",
        method: "GET",
        route: "https://attacker.invalid/export-key",
      }) + "\n",
    encoding: "utf8",
    timeout: 5000,
  });
  const parsed = JSON.parse(result);
  if (parsed.error?.status !== 400)
    throw Error("Broker accepted an arbitrary request");
  for (const deadline of [Date.now() - 1000, undefined]) {
    const expired = JSON.parse(
      execFileSync(binary, [], {
        input:
          JSON.stringify({
            id: "expired",
            method: "GET",
            route: "/api/oauth/profile",
            deadline,
          }) + "\n",
        encoding: "utf8",
        timeout: 5000,
      }),
    );
    if (expired.error?.status !== 408 || expired.error?.delivery !== "not-sent")
      throw Error("Expired request was not rejected before native work");
  }
  console.log(
    "Native broker route and encryption checks passed without keychain access.",
  );
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
