// Share only overlapping reads. Settled results and failures are never retained.
export class ReadCoordinator {
  constructor() {
    this.pending = new Map();
  }
  run(key, read) {
    const id = JSON.stringify(key);
    const existing = this.pending.get(id);
    if (existing) return existing;
    const work = Promise.resolve()
      .then(read)
      .finally(() => {
        if (this.pending.get(id) === work) this.pending.delete(id);
      });
    this.pending.set(id, work);
    return work;
  }
}
