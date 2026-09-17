// Local system notifications only. Never acknowledge sessions or unsubscribe.
export async function clearNotifications(navigator, document) {
  if (document.visibilityState !== "visible" || !navigator.serviceWorker) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration || document.visibilityState !== "visible") return;
    const notifications = await registration.getNotifications();
    if (document.visibilityState !== "visible") return;
    for (const notification of notifications) {
      try { notification.close(); } catch { /* Continue clearing the others. */ }
    }
  } catch { /* Notification support must not block opening the app. */ }
}
