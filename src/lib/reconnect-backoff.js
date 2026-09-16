export function createReconnectBackoff(random = Math.random) {
  let failures = 0;
  return {
    next() {
      const base = Math.min(30000, 1000 * 2 ** Math.min(failures++, 5));
      return Math.min(30000, Math.round(base * (1 + random() * 0.2)));
    },
    reset() {
      failures = 0;
    },
  };
}
