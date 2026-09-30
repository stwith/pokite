import fs from "node:fs";
import path from "node:path";
import { randomInt, timingSafeEqual } from "node:crypto";
import { writeFileAtomic } from "./json-file.mjs";

export function matchesAccessToken(credential, expected) {
  if (typeof credential !== "string" || typeof expected !== "string")
    return false;
  const normalize = /^[A-HJ-NP-Z2-9]{20}$/.test(expected)
    ? credential.replace(/[\s-]/g, "").toUpperCase()
    : credential;
  const got = Buffer.from(normalize),
    want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}
export function generateAccessToken() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 20 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
}
export function rotateAccessToken(directory) {
  const file = path.join(directory, "access-token");
  const token = generateAccessToken();
  writeFileAtomic(file, token);
  return token;
}
// Reset notification access before changing the code. Accepted Agent tasks and
// accounts are untouched; previously subscribed browsers must opt in again.
export function clearSavedPushAccess(directory) {
  const file = path.join(directory, "push.json");
  if (!fs.existsSync(file)) return;
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.devices = {};
  state.outbox = [];
  writeFileAtomic(file, JSON.stringify(state));
}
