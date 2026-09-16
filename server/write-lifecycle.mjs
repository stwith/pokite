export function installWriteLifecycle(app) {
  const pending = new Set();
  let closing = false;
  app.use((req, res, next) => {
    if (closing)
      return res
        .status(503)
        .json({ error: "服务正在退出，请稍后重试", delivery: "not-sent" });
    next();
  });
  app.locals.beginShutdown = () => {
    closing = true;
  };
  app.locals.drainWrites = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };
  return (route, handler) =>
    app.post(route, async (req, res) => {
      if (closing)
        return res
          .status(503)
          .json({ error: "服务正在退出，请稍后重试", delivery: "not-sent" });
      const work = Promise.resolve().then(() => handler(req, res));
      pending.add(work);
      try {
        await work;
      } finally {
        pending.delete(work);
      }
    });
}
