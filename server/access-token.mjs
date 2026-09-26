import fs from "node:fs";
import path from "node:path";
import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";

export function matchesAccessToken(credential, expected) {
  if (typeof credential !== "string" || typeof expected !== "string")
    return false;
  const normalize = /^[A-HJ-NP-Z2-9]{10}$/.test(expected)
    ? credential.replace(/[\s-]/g, "").toUpperCase()
    : credential;
  const got = Buffer.from(normalize),
    want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}
export function generateAccessToken() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 10 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
}
export function rotateAccessToken(directory) {
  const file = path.join(directory, "access-token");
  const temporary = file + "." + randomUUID();
  const token = generateAccessToken();
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
