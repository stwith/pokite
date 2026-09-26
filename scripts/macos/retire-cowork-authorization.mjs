import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
if (process.platform !== "darwin") throw Error("macOS required");
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-retire-access-"));
try {
  const binary = path.join(dir, "retire-access");
  execFileSync(
    "/usr/bin/xcrun",
    [
      "swiftc",
      "-swift-version",
      "5",
      fileURLToPath(
        new URL(
          "../../native/retire-claude-keychain-access.swift",
          import.meta.url,
        ),
      ),
      "-o",
      binary,
    ],
    { stdio: "pipe", timeout: 180000 },
  );
  execFileSync(binary, process.argv.includes("--apply") ? ["--apply"] : [], {
    stdio: "inherit",
    timeout: 180000,
  });
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
