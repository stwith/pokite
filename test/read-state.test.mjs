import test from "node:test";
import assert from "node:assert/strict";
import { presentSession } from "../server/read-state.mjs";
const session = {
  id: "s",
  projectId: "p",
  status: "completed",
  revision: "new",
};
test("desktop read state wins over obsolete local revision formats", () => {
  const s = presentSession({ "codex:s": "2026-09-13T00:00:00Z" }, "codex", {
    ...session,
    nativeUnread: false,
  });
  assert.equal(s.unread, false);
  assert.equal(s.status, "idle");
});
test("native unread remains unread until viewed locally or on desktop", () => {
  assert.equal(
    presentSession({}, "codex", { ...session, nativeUnread: true }).unread,
    true,
  );
  assert.equal(
    presentSession({ "codex:s": "new" }, "codex", {
      ...session,
      nativeUnread: true,
    }).unread,
    false,
  );
  assert.equal(
    presentSession({}, "codex", {
      ...session,
      nativeUnread: true,
      status: "running",
    }).unread,
    false,
  );
});
test("idle metadata is never itself new unread output; fresh completion is", () => {
  const reads = { "initialized:v2:dsh:p": true, "dsh:s": "old" };
  assert.equal(
    presentSession(reads, "dsh", { ...session, status: "idle" }).unread,
    false,
  );
  assert.equal(presentSession(reads, "dsh", session).unread, true);
  assert.equal(presentSession({}, "dsh", session).unread, false);
});
