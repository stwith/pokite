import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { SessionEvents } from "../server/session-events.mjs";
import { serveEventStream } from "../server/event-stream.mjs";
test("old and repeated unsubscribe never remove the replacement group", () => {
  const adapter = {},
    events = new SessionEvents({ a: adapter });
  const old = events.subscribe("a", () => {});
  events.close();
  const current = events.subscribe("a", () => {}),
    callback = adapter.onChange;
  old();
  old();
  assert.equal(events.groups.size, 1);
  assert.equal(adapter.onChange, callback);
  current();
  assert.equal(events.groups.size, 0);
});
test("a failing subscriber does not prevent delivery to other clients", async () => {
  const events = new SessionEvents({ a: {} });
  events.subscribe("a", () => {
    throw Error("closed transport");
  });
  const delivered = new Promise((resolve) => events.subscribe("a", resolve));
  events.notify("a");
  await delivered;
  assert.equal(events.groups.get("a").listeners.size, 1);
  events.close();
});
test("initial stream backpressure releases its subscription immediately", () => {
  const events = new SessionEvents({ a: {} });
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    set() {},
    flushHeaders() {},
    write() {
      return false;
    },
    end() {
      this.writableEnded = true;
      this.emit("close");
    },
  });
  serveEventStream({ params: { agent: "a" } }, response, events);
  assert.equal(response.writableEnded, true);
  assert.equal(events.groups.size, 0);
});
test("disconnect while flushing headers cannot install an orphan subscription", () => {
  const events = new SessionEvents({ a: {} });
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    set() {},
    flushHeaders() {
      this.emit("close");
    },
    write() {
      throw Error("must not write");
    },
    end() {
      this.writableEnded = true;
    },
  });
  serveEventStream({ params: { agent: "a" } }, response, events);
  assert.equal(events.groups.size, 0);
});
