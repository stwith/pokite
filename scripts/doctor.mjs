import fs from "node:fs/promises";
import path from "node:path";
import { CodexReadOnly } from "../server/codex-readonly.mjs";
import { discoverMachine } from "../server/machine-discovery.mjs";
import { loadInstances } from "../server/instances.mjs";
import { sharedProfile } from "../server/shared-config.mjs";
import { matchesProcessGeneration } from "../server/process-identity.mjs";

const results = [];
for (const instance of loadInstances()) {
  let status = "ready",
    note = "";
  try {
    if (instance.provider === "codex") {
      const reader = new CodexReadOnly(instance.home);
      try {
        reader.database();
      } finally {
        reader.close();
      }
      const shared = sharedProfile(instance.id);
      if (!shared) {
        status = "read-only";
        note = "Shared Desktop connection not configured";
      } else {
        const state = JSON.parse(await fs.readFile(shared.stateFile, "utf8"));
        if (
          path.resolve(shared.home) !== path.resolve(instance.home) ||
          state.home !== instance.home ||
          !state.desktopReady ||
          !matchesProcessGeneration(state)
        )
          throw Error(
            "Desktop shared process is not ready or identity differs",
          );
        const response = await fetch(
          shared.endpoint.replace(/^ws:/, "http:") + "/readyz",
          { signal: AbortSignal.timeout(3000) },
        );
        if (!response.ok) throw Error("Desktop backend health check failed");
        note =
          "Native store and shared backend reachable; RPC compatibility is covered by isolated tests";
      }
    } else if (instance.provider === "dsh") {
      const response = await fetch(instance.url, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw Error("DSH web service unavailable");
      note = "Existing web service reachable; no process started";
    } else if (instance.provider === "penguin") {
      const lock = JSON.parse(
        await fs.readFile(
          path.join(instance.home, ".penguin/data/server.lock"),
          "utf8",
        ),
      );
      const response = await fetch(`http://127.0.0.1:${Number(lock.port)}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.status >= 500) throw Error("Penguin service unavailable");
      note = "Existing local service reachable; no process started";
    } else {
      await fs.access(instance.home);
      status =
        instance.provider === "claudeDesktop" ? "read-only" : "configured";
      note =
        instance.provider === "claudeDesktop"
          ? "Local history only"
          : "Local configuration exists; provider login not exercised";
    }
  } catch (error) {
    status = "unavailable";
    note = error.code
      ? "Local prerequisite unavailable: " + error.code
      : error.message;
  }
  results.push({ id: instance.id, provider: instance.provider, status, note });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      detectedApps: discoverMachine().apps,
      instances: results,
    },
    null,
    2,
  ),
);
if (results.some((x) => x.status === "unavailable")) process.exitCode = 1;
