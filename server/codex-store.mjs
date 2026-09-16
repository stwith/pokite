import fs from "node:fs";
import path from "node:path";
export function codexDatabasePath(home) {
  let files;
  try {
    files = fs.readdirSync(home);
  } catch {
    return null;
  }
  const candidates = files
    .flatMap((name) => {
      const match = /^state_(\d+)\.sqlite$/.exec(name);
      return match ? [{ name, version: Number(match[1]) }] : [];
    })
    .sort((a, b) => b.version - a.version);
  return candidates.length ? path.join(home, candidates[0].name) : null;
}
