import { useEffect, useState } from "react";
import { browserStorage as storage } from "../lib/browser-storage";

// Whether some local data could not be saved; retried when the page regains
// focus or visibility.
export function useStorageStatus() {
  const [storageUnavailable, setStorageUnavailable] = useState(() =>
    storage.hasUnsaved(),
  );
  useEffect(() => {
    const unsubscribe = storage.subscribe(setStorageUnavailable);
    const retry = () => {
      if (!document.hidden) storage.retry();
    };
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, []);
  return storageUnavailable;
}
