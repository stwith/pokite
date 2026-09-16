import fs from "node:fs/promises";
import path from "node:path";

// Include all Desktop accounts and archived sessions: ownership survives logout.
export async function desktopCodeSessionIds(root) {
  const ids = new Set();
  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 2) await walk(file, depth + 1);
      else if (entry.isFile() && /^local_.*\.json$/.test(entry.name)) {
        const row = JSON.parse(await fs.readFile(file, "utf8"));
        if (typeof row.cliSessionId === "string") ids.add(row.cliSessionId);
      }
    }
  }
  await walk(path.join(root, "claude-code-sessions"), 0);
  return ids;
}
