import { sharingConfigFile } from "./state-paths.mjs";
import fs from "node:fs";
export const sharedConfigFile = sharingConfigFile();
export function sharedProfile(id) {
  try {
    const config = JSON.parse(fs.readFileSync(sharedConfigFile, "utf8"));
    const profile = config.profiles?.[id];
    return profile?.enabled === true ? profile : null;
  } catch {
    return null;
  }
}
