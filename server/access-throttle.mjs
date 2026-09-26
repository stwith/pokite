export class AccessThrottle {
  constructor(now = Date.now) {
    this.now = now;
    this.failures = new Map();
  }
  blocked(peer) {
    for (const [key, row] of this.failures)
      if (row.until <= this.now()) this.failures.delete(key);
    return (
      (this.failures.get(peer)?.count || 0) >= 10 ||
      (this.failures.get("*")?.count || 0) >= 100
    );
  }
  failed(peer) {
    for (const key of [peer, "*"]) {
      const row = this.failures.get(key) || {
        count: 0,
        until: this.now() + 60000,
      };
      row.count++;
      this.failures.set(key, row);
    }
  }
  succeeded(peer) {
    this.failures.delete(peer);
  }
}
