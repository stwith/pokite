import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { stateDirectory } from "../server/state-paths.mjs";
const directory = stateDirectory();
const { port } = JSON.parse(
  await fs.readFile(path.join(directory, "server-state.json"), "utf8"),
);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid local service port");
const token = (
  await fs.readFile(path.join(directory, "access-token"), "utf8")
).trim();
const base = `http://127.0.0.1:${port}/`;
const response = await fetch(base + "api/auth/pairing-code", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  },
  body: "{}",
  signal: AbortSignal.timeout(5000),
  redirect: "error",
});
if (!response.ok)
  throw Error("Could not create local pairing ticket: " + response.status);
const { pairingToken } = await response.json();
if (typeof pairingToken !== "string" || !/^[\w-]{32}$/.test(pairingToken))
  throw Error("Invalid pairing ticket");
execFile(
  "/usr/bin/open",
  [base + "#token=" + encodeURIComponent(pairingToken)],
  (error) => {
    if (error) {
      console.error("Could not open browser");
      process.exitCode = 1;
    }
  },
);
