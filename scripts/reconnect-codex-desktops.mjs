import { discoverMachine } from "../server/machine-discovery.mjs";
if (process.argv.includes("--apply"))
  throw Error(
    "Automatic Desktop restart is retired. Prepare/enable sharing with setup-codex-sharing.mjs, then restart Desktop after its tasks finish.",
  );
console.log(
  JSON.stringify(
    {
      profiles: discoverMachine().candidates.filter(
        (x) => x.provider === "codex",
      ),
      action:
        "Inspect setup-codex-sharing.mjs --dry-run; no Desktop process was changed",
    },
    null,
    2,
  ),
);
