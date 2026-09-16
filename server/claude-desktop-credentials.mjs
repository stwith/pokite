import { createDecipheriv, pbkdf2Sync } from "node:crypto";

// Compatibility with Chromium's macOS v10 storage format. Unknown formats fail
// closed. Decrypted credentials stay in the calling process's memory.
export function decryptDesktopCache(encoded, password) {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.subarray(0, 3).toString() !== "v10")
    throw Error("Unsupported Desktop credential format");
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
    const value = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(3)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Invalid cache");
    return value;
  } catch {
    throw Error("Desktop credentials could not be decoded");
  } finally {
    key.fill(0);
  }
}

export function sessionCredential(
  cache,
  account,
  organization,
  now = Date.now(),
) {
  const prefix = `acct:${account}|`;
  const candidates = Object.entries(cache).filter(([key, value]) => {
    if (!key.startsWith(prefix) || !value || typeof value.token !== "string")
      return false;
    const parts = key.slice(prefix.length).split(":https://api.anthropic.com:");
    if (parts.length !== 2 || parts[0].split(":")[1] !== organization)
      return false;
    if (!parts[1].split(" ").includes("user:sessions:claude_code"))
      return false;
    return Number.isFinite(value.expiresAt) && value.expiresAt > now;
  });
  if (candidates.length !== 1)
    throw Error(
      "No unique unexpired Desktop session credential for this account and organization",
    );
  return candidates[0][1].token;
}

export function canonicalDesktopSessionId(id) {
  if (typeof id !== "string") return null;
  const match = /^(?:session_|cse_)((?:staging_)?[A-Za-z0-9]{1,64})$/.exec(id);
  return match ? `cse_${match[1]}` : null;
}
