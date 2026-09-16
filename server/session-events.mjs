import fs from "node:fs";

export class SessionEvents {
  constructor(adapters) {
    this.adapters = adapters;
    this.groups = new Map();
  }
  subscribe(agent, listener) {
    let group = this.groups.get(agent);
    if (!group) {
      group = { listeners: new Set(), watchers: [], timer: null };
      this.groups.set(agent, group);
      const adapter = this.adapters[agent];
      group.previousChange = adapter.onChange;
      group.onChange = () => {
        group.previousChange?.();
        this.notify(agent);
      };
      adapter.onChange = group.onChange;
      try {
        group.providerRelease = adapter.subscribeChanges?.(() =>
          this.notify(agent),
        );
      } catch {}
      for (const { path: directory, recursive = false } of adapter.watchPaths ||
        []) {
        try {
          group.watchers.push(
            fs
              .watch(directory, { recursive }, () => this.notify(agent))
              .on("error", () => {}),
          );
        } catch {
          /* Polling remains available for unsupported/missing native stores. */
        }
      }
    }
    group.listeners.add(listener);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      group.listeners.delete(listener);
      if (group.listeners.size) return;
      this.release(agent, group);
    };
  }
  release(agent, group) {
    // A late unsubscribe must never clear a replacement subscription group.
    if (this.groups.get(agent) !== group) return;
    clearTimeout(group.timer);
    group.providerRelease?.();
    for (const watcher of group.watchers) watcher.close();
    if (this.adapters[agent].onChange === group.onChange) {
      if (group.previousChange)
        this.adapters[agent].onChange = group.previousChange;
      else delete this.adapters[agent].onChange;
    }
    this.groups.delete(agent);
  }
  notify(agent) {
    const group = this.groups.get(agent);
    if (!group || group.timer) return;
    // Fixed trailing window bounds latency even during continuous output.
    group.timer = setTimeout(() => {
      group.timer = null;
      for (const listener of [...group.listeners]) {
        try {
          listener();
        } catch {
          group.listeners.delete(listener);
        }
      }
      if (!group.listeners.size) this.release(agent, group);
    }, 250);
  }
  close() {
    for (const [agent, group] of this.groups) {
      this.release(agent, group);
    }
    this.groups.clear();
  }
}
