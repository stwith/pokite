import http from "node:http";
import { listenAddresses, localTailnetIPs } from "./listen-addresses.mjs";
// Reconcile only extra tailnet listeners. Losing one must not take down loopback.
export class NetworkListeners {
  constructor({
    port,
    allowLan,
    handler,
    detect = localTailnetIPs,
    addresses = listenAddresses,
    create = http.createServer,
  }) {
    Object.assign(this, { port, allowLan, handler, detect, addresses, create });
    this.servers = new Map();
    this.closed = false;
    this.tailnet = [];
  }
  listening() {
    return [this.allowLan ? "0.0.0.0" : "127.0.0.1", ...this.servers.keys()];
  }
  async refresh() {
    if (this.closed) return;
    if (this.pending) return this.pending;
    this.pending = this.reconcile().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async reconcile() {
    this.tailnet = this.addresses(false, undefined, await this.detect()).slice(
      1,
    );
    const wanted = new Set(this.allowLan ? [] : this.tailnet);
    if (this.closed) return;
    for (const [ip, server] of this.servers)
      if (!wanted.has(ip)) {
        this.servers.delete(ip);
        server.close();
        server.closeAllConnections();
      }
    for (const ip of wanted) {
      if (this.closed || this.servers.has(ip)) continue;
      const server = this.create(this.handler);
      try {
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(this.port, ip, resolve);
        });
        if (this.closed) {
          server.close();
          server.closeAllConnections();
          return;
        }
        this.servers.set(ip, server);
      } catch (error) {
        server.close();
        console.error(
          "Tailnet listener unavailable:",
          ip,
          error.code || error.name,
        );
      }
    }
  }
  start() {
    this.timer = setInterval(() => {
      void this.refresh().catch((error) =>
        console.error("Network refresh failed:", error.code || error.name),
      );
    }, 10000);
    this.timer.unref();
  }
  close(force = true) {
    this.closed = true;
    clearInterval(this.timer);
    for (const s of this.servers.values()) {
      s.close();
      if (force) s.closeAllConnections();
    }
    if (force) this.servers.clear();
  }
}
