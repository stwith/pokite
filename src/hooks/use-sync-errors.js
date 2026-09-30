import { useState } from "react";

// Per-scope background sync failures shown in the retry banner. Failures
// while the page is hidden are ignored; they are expected and self-heal.
export function useSyncErrors() {
  const [syncErrors, setSyncErrors] = useState({});
  function syncFailed(scope, e) {
    if (!document.hidden)
      setSyncErrors((prev) => ({
        ...prev,
        [scope]: e.message,
      }));
  }
  function syncRecovered(scope) {
    setSyncErrors((prev) => {
      if (!(scope in prev)) return prev;
      const next = {
        ...prev,
      };
      delete next[scope];
      return next;
    });
  }
  return { syncErrors, setSyncErrors, syncFailed, syncRecovered };
}
