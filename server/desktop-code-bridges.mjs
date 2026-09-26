import fs from "node:fs/promises";
import path from "node:path";
import { canonicalDesktopSessionId } from "./cowork-session-id.mjs";
export async function desktopCodeBridges(root, account, organization) {
  const directory = path.join(
      root,
      "claude-code-sessions",
      account,
      organization,
    ),
    rows = new Map();
  for (const item of await fs
    .readdir(directory, { withFileTypes: true })
    .catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    })) {
    if (!item.isFile() || !/^local_[A-Za-z0-9-]+\.json$/.test(item.name))
      continue;
    const row = JSON.parse(
      await fs.readFile(path.join(directory, item.name), "utf8"),
    );
    if (row.isArchived || typeof row.sessionId !== "string") continue;
    const ids = [
      ...(Array.isArray(row.bridgeSessionIds) ? row.bridgeSessionIds : []),
      row.remoteControlSpawn?.ccrSessionId,
    ]
      .map(canonicalDesktopSessionId)
      .filter(Boolean);
    const workspace = row.originCwd || row.cwd;
    if (typeof workspace !== "string" || !path.isAbsolute(workspace)) continue;
    for (const id of ids)
      rows.set(id, {
        localId: row.sessionId,
        cliSessionId: row.cliSessionId,
        workspace,
        title: row.title,
      });
  }
  return rows;
}
