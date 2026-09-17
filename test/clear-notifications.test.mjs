import test from "node:test";
import assert from "node:assert/strict";
import { clearNotifications } from "../src/lib/clear-notifications.js";

test("foreground clears all notifications from this registration without touching subscriptions", async () => {
  const closed = [];
  await clearNotifications({ serviceWorker: { getRegistration: async scope => {
    assert.equal(scope, "/");
    return { getNotifications: async () => [1,2,3].map(id => ({ close: () => closed.push(id) })) };
  } } }, { visibilityState: "visible" });
  assert.deepEqual(closed, [1,2,3]);
});
test("background or unsupported pages never clear notifications", async () => {
  await clearNotifications({}, { visibilityState: "visible" });
  await clearNotifications({serviceWorker:{getRegistration:()=>{throw Error("must not run")}}}, { visibilityState: "hidden" });
});
test("returning to background during lookup preserves notifications", async () => {
  const document = {visibilityState:"visible"};
  let closed = false;
  await clearNotifications({serviceWorker:{getRegistration:async()=>({getNotifications:async()=>{
    document.visibilityState="hidden";return [{close:()=>{closed=true;}}];
  }})}}, document);
  assert.equal(closed,false);
});
