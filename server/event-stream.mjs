export function serveEventStream(req, res, events) {
  let unsubscribe = () => {},
    heartbeat,
    closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.writableEnded && !res.destroyed) res.end();
  };
  const write = (type) => {
    if (closed) return;
    if (res.destroyed || res.writableEnded) return close();
    try {
      if (!res.write("data: " + JSON.stringify({ type }) + "\n\n")) close();
    } catch {
      close();
    }
  };
  res.on("close", close);
  res.on("error", close);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  if (closed || res.destroyed) {
    close();
    return;
  }
  unsubscribe = events.subscribe(req.params.agent, () => write("change"));
  heartbeat = setInterval(() => write("heartbeat"), 15000);
  write("ready");
}
