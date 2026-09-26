import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { stateDirectory } from "../server/state-paths.mjs";
import { acquireInstanceLock } from "../server/instance-lock.mjs";

// Offline, serialized with service startup. New master invalidates the stored
// device generation even if power fails before the next startup.
const directory = stateDirectory();
const release = acquireInstanceLock(directory);
try {
  const file = path.join(directory, "access-token");
  // Migrate flat legacy registries before changing the master. Otherwise the
  // first new startup could accidentally adopt old device tokens into the new generation.
  const devicesFile = path.join(directory, "devices.json");
  if (fs.existsSync(devicesFile)) {
    const saved = JSON.parse(fs.readFileSync(devicesFile, "utf8"));
    if (!saved.masterHash) {
      const oldMaster = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : randomBytes(32).toString("hex");
      const migration = devicesFile + "." + randomUUID();
      fs.writeFileSync(migration, JSON.stringify({
        masterHash: createHash("sha256").update(oldMaster).digest("hex"), devices: saved,
      }), { mode: 0o600 });
      fs.renameSync(migration, devicesFile);
    }
  }
  const temporary = file + "." + randomUUID();
  fs.writeFileSync(temporary, randomBytes(32).toString("base64url"), {
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
  console.log(
    "Access reset. Old master and device credentials are invalid. Start Pokite, then run npm run open on this computer and pair your phones again. Agent accounts and sessions are unchanged.",
  );
} finally {
  release();
}
