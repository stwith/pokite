import net from "node:net";
// Forwarded identity is trusted only after middleware verifies the loopback
// peer and the configured Tailscale Serve host. LAN clients cannot forge it.
export function accessPeer(req) {
  if (req.pokiteServe) {
    const forwarded = req.headers["x-forwarded-for"];
    const address =
      typeof forwarded === "string" ? forwarded.split(",").at(-1).trim() : "";
    if (net.isIP(address)) return "serve:" + address;
    const login = req.headers["tailscale-user-login"];
    if (typeof login === "string" && login.length <= 254)
      return "serve-user:" + login;
    return "serve:unknown";
  }
  return "direct:" + (req.socket.remoteAddress || "unknown");
}
export class AccessThrottle {
  constructor(now = Date.now) {
    this.now = now;
    this.failures = new Map();
  }
  blocked(peer) {
    for (const [key, row] of this.failures)
      if (row.until <= this.now()) this.failures.delete(key);
    return (this.failures.get(peer)?.count || 0) >= 10;
  }
  failed(peer) {
    if (this.failures.size >= 4096 && !this.failures.has(peer))
      this.failures.delete(this.failures.keys().next().value);
    const old = this.failures.get(peer);
    const row =
      old && old.until > this.now()
        ? old
        : { count: 0, until: this.now() + 60000 };
    row.count++;
    this.failures.set(peer, row);
  }
  succeeded(peer) {
    this.failures.delete(peer);
  }
}
