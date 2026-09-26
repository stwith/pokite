import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function updateOwnedRuntime(source, destination, proxy) {
  const bytes = await fs.readFile(source);
  const current = await fs.readFile(destination).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (current && hash(bytes) === hash(current)) return false;
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = destination + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o700 });
    const version = execFileSync(temporary, ["--version"], {
      timeout: 5000,
      encoding: "utf8",
    }).trim();
    const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
    if (!(major > 22 || (major === 22 && minor >= 23)))
      throw Error("Node 22.23 or newer is required");
    execFileSync(temporary, [proxy, "--pokite-preflight"], {
      timeout: 5000,
      stdio: "pipe",
    });
    await fs.rename(temporary, destination);
    return true;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
