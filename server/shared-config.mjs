import fs from "node:fs";
export const sharedConfigFile =
  process.env.POCKET_SHARED_CONFIG ||
  new URL("../.local/codex-shared.json", import.meta.url);
export function sharedProfile(id) {
  try {
    const config = JSON.parse(fs.readFileSync(sharedConfigFile, "utf8"));
    const profile = config.profiles?.[id];
    return profile?.enabled === true ? profile : null;
  } catch {
    return null;
  }
}
