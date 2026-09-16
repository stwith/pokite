export async function shutdownServer({
  app,
  server,
  messages,
  adapters,
  flushReads,
}) {
  app.locals.beginShutdown();
  server.close();
  const drained = await Promise.allSettled([
    app.locals.drainWrites(),
    messages.stop(),
  ]);
  try {
    await flushReads();
    const failed = drained.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  } finally {
    app.locals.events.close();
    const closed = await Promise.allSettled(
      Object.values(adapters).map((adapter) =>
        Promise.resolve().then(() => adapter.close?.()),
      ),
    );
    server.closeAllConnections();
    const failed = closed.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}
