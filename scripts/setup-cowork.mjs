import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { coworkBrokerPath } from "../server/cowork-broker.mjs";
if (process.platform !== "darwin")
  throw Error("Cowork currently requires macOS");
const source = fileURLToPath(
  new URL("../native/claude-session-broker.swift", import.meta.url),
);
const binary = coworkBrokerPath(),
  directory = path.dirname(binary),
  manifest = path.join(directory, "installation.json");
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 90000,
  });
const digest = (data) => createHash("sha256").update(data).digest("hex");
const sourceHash = digest(await fs.readFile(source));
const previous = await fs
  .readFile(manifest, "utf8")
  .then(JSON.parse)
  .catch(() => null);
if (previous?.sourceHash === sourceHash) {
  try {
    run("/usr/bin/codesign", ["--verify", "--strict", binary]);
    if (digest(await fs.readFile(binary)) === previous.binaryHash) {
      console.log(
        "Cowork request broker is current; existing keychain permission retained.",
      );
      process.exit(0);
    }
  } catch {}
}
const identities = run("/usr/bin/security", [
  "find-identity",
  "-v",
  "-p",
  "codesigning",
]);
const available = [...identities.matchAll(/\) ([A-F0-9]{40}) "/g)].map(
  (match) => match[1],
);
const identity =
  process.env.POKITE_COWORK_SIGN_IDENTITY ||
  previous?.identity ||
  available[0] ||
  "-";
if (identity !== "-" && !available.includes(identity))
  throw Error("Configured Cowork signing identity is unavailable");
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const temporary = path.join(directory, ".broker-" + randomUUID());
try {
  run("/usr/bin/xcrun", [
    "swiftc",
    "-swift-version",
    "5",
    "-O",
    source,
    "-o",
    temporary,
  ]);
  run("/usr/bin/codesign", [
    "--force",
    "--sign",
    identity,
    "--identifier",
    binary.includes("/Keychain/")
      ? "app.pokite.claude-keychain"
      : "app.pokite.cowork-request-broker",
    "--options",
    "runtime",
    "--timestamp=none",
    temporary,
  ]);
  run("/usr/bin/codesign", ["--verify", "--strict", temporary]);
  if (
    run(temporary, ["--self-test"]).trim() !== "cowork-broker self-test passed"
  )
    throw Error("Broker validation failed");
  await fs.chmod(temporary, 0o700);
  const binaryHash = digest(await fs.readFile(temporary));
  await fs.rename(temporary, binary);
  await fs.writeFile(
    manifest,
    JSON.stringify(
      { sourceHash, binaryHash, identity, protocol: "cowork-broker-v1" },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Signed Cowork request broker installed. It never exports the Desktop key or OAuth token. macOS may request permission on first access.",
  );
} finally {
  await fs.rm(temporary, { force: true });
}
