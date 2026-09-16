export function createBrowserStorage(getStorage) {
  const memory = new Map(),
    dirty = new Set(),
    listeners = new Set();
  let unavailable = false;
  const notify = () => {
    for (const listener of listeners) listener(dirty.size > 0 || unavailable);
  };
  const save = (key, value) => {
    memory.set(key, value);
    try {
      const storage = getStorage();
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      dirty.delete(key);
      unavailable = false;
      notify();
      return true;
    } catch {
      dirty.add(key);
      unavailable = true;
      notify();
      return false;
    }
  };
  return {
    getItem(key) {
      if (dirty.has(key)) return memory.get(key) ?? null;
      try {
        const value = getStorage().getItem(key);
        memory.set(key, value);
        return value;
      } catch {
        unavailable = true;
        return memory.get(key) ?? null;
      }
    },
    setItem: (key, value) => save(key, String(value)),
    removeItem: (key) => save(key, null),
    hasUnsaved: () => dirty.size > 0 || unavailable,
    subscribe(listener) {
      listeners.add(listener);
      listener(dirty.size > 0 || unavailable);
      return () => listeners.delete(listener);
    },
    retry() {
      for (const key of [...dirty]) save(key, memory.get(key));
    },
  };
}
export const browserStorage = createBrowserStorage(() => window.localStorage);
