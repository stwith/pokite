import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { keychainHelperPath } from "../server/claude-keychain.mjs";

if (process.platform !== "darwin") throw new Error("This helper requires macOS");
const target = keychainHelperPath();
const directory = path.dirname(target);
const source = fileURLToPath(new URL("../native/claude-keychain.c", import.meta.url));
const hash = createHash("sha256").update(await fs.readFile(source)).digest("hex");
const manifestPath = path.join(directory, "installation.json");
const previous = await fs.readFile(manifestPath, "utf8").then(JSON.parse).catch(() => null);
const run = (binary, args) => execFileSync(binary, args, { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
if (previous?.sourceHash === hash) {
  try {
    run("/usr/bin/codesign", ["--verify", "--strict", target]);
    const installedHash = createHash("sha256").update(await fs.readFile(target)).digest("hex");
    if (installedHash === previous.binaryHash) {
      console.log("Existing signed helper unchanged; preserving saved keychain permission.");
      process.exit(0);
    }
  } catch {}
}
const identities = run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]);
const available = [...identities.matchAll(/\) ([A-F0-9]{40}) "/g)].map(m => m[1]);
const identity = process.env.POKITE_KEYCHAIN_SIGN_IDENTITY || previous?.identity || available[0];
if (!identity || !available.includes(identity))
  throw new Error("No matching signing identity. Install a code-signing certificate; no unsigned fallback is used.");
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
await fs.chmod(directory, 0o700);
const staging = await fs.mkdtemp(path.join(directory, ".build-"));
try {
  const binary = path.join(staging, "Pokite Claude Access");
  run("/usr/bin/xcrun", ["clang", "-O2", "-Wno-deprecated-declarations", "-framework", "Security", "-framework", "CoreFoundation", source, "-o", binary]);
  run("/usr/bin/codesign", ["--force", "--sign", identity, "--identifier", "app.pokite.claude-keychain", "--options", "runtime", "--timestamp=none", binary]);
  run("/usr/bin/codesign", ["--verify", "--strict", binary]);
  if (run(binary, ["--version"]).trim() !== "pokite-claude-keychain 1") throw new Error("Helper verification failed");
  await fs.chmod(binary, 0o700);
  const binaryHash = createHash("sha256").update(await fs.readFile(binary)).digest("hex");
  await fs.rename(binary, target);
  await fs.writeFile(manifestPath, JSON.stringify({ sourceHash: hash, binaryHash, identity }, null, 2) + "\n", { mode: 0o600 });
  console.log("Signed Pokite Claude Access installed. Next access may require Always Allow in macOS.");
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
