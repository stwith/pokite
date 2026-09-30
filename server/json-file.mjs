import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const target = (file) => (file instanceof URL ? fileURLToPath(file) : file);

// Parsed JSON, or `fallback` when the file does not exist. A corrupt file
// throws rather than silently resetting state.
export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(target(file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

// Owner-only atomic replace: readers see the old or the new file, never a
// partial one. A unique temporary name keeps overlapping writers apart.
export function writeFileAtomic(file, data) {
  file = target(file);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + "." + randomUUID();
  try {
    fs.writeFileSync(temporary, data, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export async function writeFileAtomicAsync(file, data) {
  file = target(file);
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + "." + randomUUID();
  try {
    await fsp.writeFile(temporary, data, { mode: 0o600 });
    await fsp.rename(temporary, file);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}
