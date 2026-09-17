/* Notifications only: never cache private API responses or credentials. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {}
  let url = new URL("/", self.location.origin);
  try {
    const candidate = new URL(data.url, self.location.origin);
    if (candidate.origin === self.location.origin) url = candidate;
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Pokite", {
      body: data.body || "任务状态已更新",
      icon: "/brand/pokite-192.png",
      tag: data.tag || "pokite",
      data: { url: url.href },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL(
        event.notification.data?.url || "/",
        self.location.origin,
      );
      if (url.origin !== self.location.origin) return;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const window of windows) {
        if (new URL(window.url).origin !== url.origin) continue;
        // Let the app select the session without discarding an in-memory draft.
        window.postMessage({ type: "pokite-open-session", url: url.href });
        await window.focus();
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
