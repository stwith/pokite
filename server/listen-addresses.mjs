import os from "node:os";
import { tailscaleCommand } from "./tailscale-command.mjs";
export async function localTailnetIPs() {
  try {
    const { stdout } = await tailscaleCommand(["status", "--json"]);
    const status = JSON.parse(stdout);
    return status.BackendState === "Running"
      ? status.Self?.TailscaleIPs || []
      : [];
  } catch {
    return [];
  }
}
export function listenAddresses(
  allowLan,
  interfaces = os.networkInterfaces(),
  tailscaleIPs = [],
) {
  if (allowLan) return ["0.0.0.0"];
  const tailnet = Object.values(interfaces)
    .flat()
    .filter(Boolean)
    .filter(
      (r) =>
        r.family === "IPv4" &&
        tailscaleIPs.includes(r.address) &&
        /^100\./.test(r.address) &&
        +r.address.split(".")[1] >= 64 &&
        +r.address.split(".")[1] <= 127,
    )
    .map((r) => r.address);
  return ["127.0.0.1", ...new Set(tailnet)];
}
