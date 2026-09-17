import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
let serveCache;
let servePending;
export async function tailscaleHttpsLink(port) {
  if (serveCache && Date.now() - serveCache.time < 5000) return serveCache.link;
  if (servePending) return servePending;
  servePending = (async () => {
    let link = null;
    try {
      const { stdout } = await exec("tailscale", ["serve", "status", "--json"], { timeout: 3000, maxBuffer: 65536 });
      const config = JSON.parse(stdout);
      for (const [host, web] of Object.entries(config.Web || {})) {
        if (!config.TCP?.[host.split(":").at(-1)]?.HTTPS || config.AllowFunnel?.[host]) continue;
        if (web.Handlers?.["/"]?.Proxy !== `http://127.0.0.1:${port}`) continue;
        if (!/^[a-zA-Z0-9.-]+\.ts\.net:\d+$/.test(host)) continue;
        link = { url: `https://${host.replace(/:443$/, "")}/`, address: host.split(":")[0] };
        break;
      }
    } catch { /* Serve unavailable: keep the LAN entry usable. */ }
    serveCache = { time: Date.now(), link };
    return link;
  })().finally(() => { servePending = null; });
  return servePending;
}
export function networkLinks(
  port,
  interfaces = os.networkInterfaces(),
  preferred,
) {
  const addresses = Object.entries(interfaces).flatMap(([name, rows]) =>
    (rows || [])
      .filter((row) => row.family === "IPv4" && !row.internal)
      .map((row) => ({ name, address: row.address })),
  );
  const parts = (address) => address.split(".").map(Number);
  const tailscale = (address) => {
    const [a, b] = parts(address);
    return a === 100 && b >= 64 && b <= 127;
  };
  const privateLan = (address) => {
    const [a, b] = parts(address);
    return (
      a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
    );
  };
  const score = (row) =>
    row.address === preferred
      ? 0
      : /^(en\d|eth\d|wlan\d|Wi-Fi|Ethernet)/i.test(row.name)
        ? 1
        : 2;
  const choose = (predicate) =>
    addresses
      .filter((row) => predicate(row.address))
      .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))[0];
  const link = (row) =>
    row
      ? { url: `http://${row.address}:${port}/`, address: row.address }
      : null;
  return { lan: link(choose(privateLan)), tailscale: link(choose(tailscale)) };
}
