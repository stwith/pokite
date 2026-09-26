import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export async function tailscaleCommand(args, run = exec) {
  const candidates = [
    "tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ];
  let last;
  for (const command of candidates) {
    try {
      return await run(command, args, {
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
