#!/usr/bin/env node
// Self-contained end-to-end checks: each script starts its own fixtures and
// drives the built UI with Playwright (run `npm run build` first). Scripts
// named verify-* but not listed here talk to live agents on this machine and
// are run by hand.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const portable = process.argv.includes("--portable");
if (process.argv.slice(2).some((arg) => arg !== "--portable")) {
  console.error("Usage: npm run verify [-- --portable]");
  process.exit(1);
}
const suite = [
  "verify-session-sync",
  "verify-scroll-pagination",
  "verify-auth-expiry",
  "verify-device-login",
  "verify-settings-ui",
  "verify-agent-settings-ui",
  "verify-claude-controls-ui",
  "verify-cowork-ui",
  "verify-cowork-broker",
  ...(!portable ? ["verify-shared-codex"] : []),
  "verify-audit-recovery",
  "verify-chat-files",
];
if (portable)
  console.log("Portable checks: shared Codex integration requires a local Desktop binary and remains in the full local suite.");
const failed = [];
for (const name of suite) {
  const script = fileURLToPath(new URL(`./${name}.mjs`, import.meta.url));
  const { status } = spawnSync(process.execPath, [script], {
    stdio: "inherit",
  });
  if (status !== 0) failed.push(name);
}
if (failed.length) {
  console.error("Failed:", failed.join(", "));
  process.exit(1);
}
console.log(`All ${suite.length} end-to-end checks passed.`);
