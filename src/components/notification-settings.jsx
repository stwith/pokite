import { useState } from "react";
import { Bell } from "lucide-react";
import { Switch } from "radix-ui";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";
import { api } from "../lib/api";

export function NotificationSettings() {
  const [open, setOpen] = useState(false);
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
        ? (await api("/notifications/status", { endpoint: sub.endpoint }))
            .enabled
        : false,
    );
  }
  async function toggle(next) {
    if (!next) {
      if (subscription) {
        await api("/notifications/remove", { endpoint: subscription.endpoint });
        setEnabled(false);
        await subscription.unsubscribe();
        setSubscription(null);
      }
      return;
    }
    if ((await Notification.requestPermission()) !== "granted")
      throw Error("请在系统设置中允许 Pokite 通知。");
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
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) void run(load);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="任务通知">
          <Bell size={18} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="connection-title">任务通知</DialogTitle>
        <DialogDescription className="connection-description">
          任务完成或失败时提醒你，点击通知回到对应会话。
        </DialogDescription>
        {!isSecureContext ? (
          <p className="notification-hint">请通过 HTTPS 入口开启通知。</p>
        ) : !supported ? (
          <p className="notification-hint">
            iPhone / iPad 请将 HTTPS 网页添加到主屏幕，再从主屏幕打开。
          </p>
        ) : (
          <>
            <div className="notification-setting">
              <div>
                <label htmlFor="task-notifications">接收任务通知</label>
                <p>所有已接入 Agent 的项目，无需逐个关注</p>
              </div>
              <Switch.Root
                id="task-notifications"
                className="notification-switch"
                checked={enabled}
                disabled={busy}
                onCheckedChange={(value) => run(() => toggle(value))}
                aria-label="接收任务通知"
              >
                <Switch.Thumb className="notification-switch-thumb" />
              </Switch.Root>
            </div>
            <p className="notification-hint">
              仅控制这台设备。通知显示会话标题和项目路径，不含对话正文。电脑需保持运行并联网。
            </p>
          </>
        )}
        {error && (
          <p className="notification-error" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
