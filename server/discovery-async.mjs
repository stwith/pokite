import { Worker } from "node:worker_threads";
let pending;
export function discoverMachineAsync() {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./discovery-worker.mjs", import.meta.url),
    );
    const timer = setTimeout(() => {
      reject(Error("Agent discovery timed out"));
      void worker.terminate();
    }, 30000);
    let received = false;
    worker.once("message", (value) => {
      received = true;
      clearTimeout(timer);
      resolve(value);
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !received)
        reject(Error("Agent discovery worker exited: " + code));
    });
  }).finally(() => {
    pending = null;
  });
  return pending;
}
