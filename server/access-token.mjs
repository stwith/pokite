import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

export function rotateAccessToken(directory) {
  const file = path.join(directory, "access-token");
  const temporary = file + "." + randomUUID();
  const token = randomBytes(32).toString("base64url");
  try {
    fs.writeFileSync(temporary, token, { mode: 0o600 });
    fs.renameSync(temporary, file);
    return token;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
// Reset notification access before changing the code. Accepted Agent tasks and
// accounts are untouched; previously subscribed browsers must opt in again.
export function clearSavedPushAccess(directory) {
  const file = path.join(directory, "push.json");
  if (!fs.existsSync(file)) return;
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.devices = {};
  state.outbox = [];
  const temporary = file + "." + randomUUID();
  try {
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
