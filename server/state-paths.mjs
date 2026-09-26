import os from "node:os";
import path from "node:path";

export function stateDirectory(env = process.env, home = os.homedir()) {
  const explicit = env.POKITE_STATE_DIR ?? env.POCKET_STATE_DIR;
  if (explicit !== undefined && !explicit.trim()) throw Error("State directory must not be empty");
  return path.resolve(
    env.POKITE_STATE_DIR ||
      env.POCKET_STATE_DIR ||
      (process.platform === "darwin"
        ? path.join(home, "Library/Application Support/Pokite/state")
        : path.join(
            env.XDG_STATE_HOME || path.join(home, ".local/state"),
            "pokite",
          )),
  );
}
export const stateFile = (name) => path.join(stateDirectory(), name);
export const instanceConfigFile = () =>
  process.env.POKITE_CONFIG ??
  process.env.POCKET_CONFIG ??
  stateFile("instances.json");
export const sharingConfigFile = () =>
  process.env.POKITE_SHARED_CONFIG ??
  process.env.POCKET_SHARED_CONFIG ??
  stateFile("codex-shared.json");
