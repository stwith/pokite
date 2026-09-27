import test from "node:test";
import assert from "node:assert/strict";
import { SessionEvents } from "../server/session-events.mjs";

test("broadcast releases a group whose final listener throws", () => {
  let released = 0,
    closed = 0;
  const previous = () => {};
  const adapter = {
    onChange: previous,
    subscribeChanges: () => () => {
      released++;
    },
  };
  const events = new SessionEvents({ a: adapter });
  const unsubscribe = events.subscribe("a", () => {
    throw Error("listener gone");
  });
  events.groups.get("a").watchers.push({
    close() {
      closed++;
    },
  });
  events.notify("a");
  events.broadcast("agents-change");
  assert.equal(events.groups.size, 0);
  assert.equal(released, 1);
  assert.equal(closed, 1);
  assert.equal(adapter.onChange, previous);
  unsubscribe();
  events.close();
  assert.equal(released, 1);
});
