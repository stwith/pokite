// Weight is retained-data accounting, not a measurement of the JavaScript heap.
export class WeightedCache {
  constructor({ maxEntries = 100, maxWeight = 16 * 1024 * 1024, weigh }) {
    this.maxEntries = maxEntries;
    this.maxWeight = maxWeight;
    this.weigh = weigh;
    this.entries = new Map();
    this.weight = 0;
  }
  get size() {
    return this.entries.size;
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key, value) {
    this.delete(key);
    const weight = this.weigh(value);
    if (!Number.isFinite(weight) || weight < 0 || weight > this.maxWeight)
      return;
    this.entries.set(key, { value, weight });
    this.weight += weight;
    while (this.size > this.maxEntries || this.weight > this.maxWeight)
      this.delete(this.entries.keys().next().value);
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.weight -= entry.weight;
    this.entries.delete(key);
  }
  clear() {
    this.entries.clear();
    this.weight = 0;
  }
}
