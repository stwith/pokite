import { execFileSync } from "node:child_process";
export function processStartedAt(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const text = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 1500,
      env: { ...process.env, LC_ALL: "C" },
    }).trim();
    const time = Date.parse(text);
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}
export function matchesProcessGeneration(
  state,
  startedAt = processStartedAt(state.pid),
) {
  // ps has second precision; a process born after the saved record is a reused PID.
  return (
    Number.isFinite(startedAt) &&
    Number.isFinite(state.startedAt) &&
    startedAt <= state.startedAt + 1000
  );
}
