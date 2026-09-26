import { t } from "../lib/i18n.js";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Switch } from "radix-ui";
import { api } from "../lib/api";
export function NotificationSettings() {
  const [subscription, setSubscription] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  const supported =
    location.protocol === "https:" &&
    isSecureContext &&
    (!ios || standalone) &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    if (!supported) return;
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    setSubscription(sub);
    setEnabled(
      sub
        ? (
            await api("/notifications/status", {
              endpoint: sub.endpoint,
            })
          ).enabled
        : false,
    );
  }
  async function toggle(next) {
    if (!next) {
      if (subscription) {
        await api("/notifications/remove", {
          endpoint: subscription.endpoint,
        });
        setEnabled(false);
        await subscription.unsubscribe();
        setSubscription(null);
      }
      return;
    }
    if ((await Notification.requestPermission()) !== "granted")
      throw Error(t("请在系统设置中允许 Pokite 通知。"));
    const { publicKey } = await api("/notifications/config");
    const key = Uint8Array.from(
      atob(
        publicKey.replace(/-/g, "+").replace(/_/g, "/") +
          "=".repeat((4 - (publicKey.length % 4)) % 4),
      ),
      (c) => c.charCodeAt(0),
    );
    const registration = await navigator.serviceWorker.ready;
    const sub =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      }));
    setSubscription(sub);
    const result = await api("/notifications/subscribe", {
      subscription: sub.toJSON(),
    });
    setEnabled(result.enabled);
  }
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <div className="notification-inline">
      <div className="settings-language notification-inline-row">
        <label htmlFor="task-notifications">
          <Bell size={18} />
          {t("任务通知")}
        </label>
        <Switch.Root
          id="task-notifications"
          className="notification-switch"
          checked={enabled}
          disabled={busy || !supported}
          onCheckedChange={(value) => run(() => toggle(value))}
          aria-label={t("任务通知")}
        >
          <Switch.Thumb className="notification-switch-thumb" />
        </Switch.Root>
      </div>
      {!supported && (
        <p className="notification-inline-hint">
          {location.protocol !== "https:"
            ? t("需使用 HTTPS")
            : ios && !standalone
              ? t("请从主屏幕打开")
              : t("当前浏览器不支持通知")}
        </p>
      )}
      {error && (
        <p className="notification-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
