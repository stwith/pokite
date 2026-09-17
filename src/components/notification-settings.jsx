import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";
import { api } from "../lib/api";

export function NotificationSettings({ agent, project }) {
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const secure = window.isSecureContext;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  const supported =
    secure &&
    (!ios || standalone) &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const watched = state?.projects?.some(
    (p) => p.agent === agent && p.projectId === project?.id,
  );
  const run = async (fn) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  async function load() {
    if (!supported) return;
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    setSubscription(sub);
    setState(
      sub
        ? await api("/notifications/status", { endpoint: sub.endpoint })
        : null,
    );
  }
  async function enable() {
    if (!project) throw Error("请先选择要接收通知的项目");
    const permission = await Notification.requestPermission();
    if (permission !== "granted")
      throw Error("通知权限未开启，请在系统设置中允许 Pokite 通知。");
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
    setState(
      await api("/notifications/subscribe", {
        subscription: sub.toJSON(),
        agent,
        projectId: project.id,
      }),
    );
    setMessage("已关注当前项目。电脑端或手机端任务完成、失败时都会提醒。");
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
          任务完成或失败后提醒你，点击通知回到对应会话。
        </DialogDescription>
        {!secure ? (
          <p>请通过 Tailscale HTTPS 入口开启通知。</p>
        ) : !supported ? (
          <p>
            iPhone / iPad 请先将 HTTPS
            网页添加到主屏幕，再从主屏幕打开并开启通知。
          </p>
        ) : (
          <>
            <p>当前项目：{project?.name || "尚未选择"}</p>
            <p className="muted">
              默认不在锁屏显示项目名称和对话内容。Mac 和 Pokite
              需要保持运行并联网。
            </p>
            <Button
              disabled={busy || !project}
              onClick={() =>
                run(async () => {
                  if (!watched) return enable();
                  await api("/notifications/remove", {
                    endpoint: subscription.endpoint,
                    project: { agent, projectId: project.id },
                  });
                  await load();
                })
              }
            >
              {watched
                ? "取消关注当前项目"
                : state?.enabled
                  ? "关注当前项目"
                  : "开启通知并关注当前项目"}
            </Button>
            {state?.enabled && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 12,
                  flexWrap: "wrap",
                }}
              >
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await api("/notifications/test", {
                        endpoint: subscription.endpoint,
                      });
                      setMessage(r.message);
                    })
                  }
                >
                  发送测试通知
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("/notifications/remove", {
                        endpoint: subscription.endpoint,
                      });
                      await subscription.unsubscribe();
                      setSubscription(null);
                      setState(null);
                      setMessage("已关闭本设备通知");
                    })
                  }
                >
                  关闭本设备通知
                </Button>
              </div>
            )}
            {state?.enabled && (
              <p className="muted">
                已关注 {state.projects.length}{" "}
                个项目。推送服务接收不等于手机已经显示通知。
              </p>
            )}
          </>
        )}
        {message && <p role="status">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}
