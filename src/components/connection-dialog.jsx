import { t } from "../lib/i18n.js";
import { useEffect, useRef, useState } from "react";
import { Tabs } from "radix-ui";
import { QrCode, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { api } from "../lib/api";
import { CopyButton } from "./copy-button";
import { HomeScreenGuide } from "./home-screen-guide";
function Code({ url, label }) {
  const canvas = useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    import("qrcode")
      .then(({ default: QRCode }) => {
        if (alive)
          return QRCode.toCanvas(canvas.current, url, {
            width: 264,
            margin: 4,
            errorCorrectionLevel: "M",
            color: {
              dark: "#171717",
              light: "#ffffff",
            },
          });
      })
      .catch(() => {
        if (alive) setError(t("二维码生成失败，请使用下方链接"));
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <canvas
          ref={canvas}
          width={264}
          height={264}
          role="img"
          aria-label={label}
        />
      )}
    </>
  );
}
export function ConnectionDialog() {
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState(() => {
      const host = location.hostname;
      const parts = host.split(".").map(Number);
      if (location.protocol === "https:" && host.endsWith(".ts.net"))
        return "tailscaleHttps";
      return host.endsWith(".ts.net") ||
        (parts.length === 4 &&
          parts[0] === 100 &&
          parts[1] >= 64 &&
          parts[1] <= 127)
        ? "tailscale"
        : "lan";
    }),
    [links, setLinks] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLinks(null);
    setError("");
    api("/connection-links")
      .then((value) => {
        if (alive) setLinks(value);
      })
      .catch((error) => {
        if (alive) setError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [open]);
  const address = links?.[mode]?.url;
  const accessCode = links?.accessToken;
  const url = address
    ? address +
      (accessCode ? "#token=" + encodeURIComponent(accessCode) : "")
    : "";
  const label =
    mode === "lan"
      ? t("局域网 HTTP")
      : mode === "tailscale"
        ? "Tailscale HTTP"
        : "Tailscale HTTPS";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="connection-trigger"
          aria-label={t("连接手机")}
        >
          <QrCode size={18} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="connection-title">
          {t("连接手机或平板")}
        </DialogTitle>
        <DialogDescription className="connection-description">
          {mode === "lan"
            ? t("手机与电脑连接同一局域网，然后扫码连接。")
            : mode === "tailscale"
              ? t("开启 Tailscale 后扫码连接，无需使用 Tailscale DNS。")
              : t(
                  "通过 HTTPS 加密访问。请开启 Tailscale，并启用“使用 Tailscale DNS”。",
                )}
        </DialogDescription>
        <Tabs.Root value={mode} onValueChange={setMode}>
          <Tabs.List className="connection-tabs" aria-label={t("连接网络")}>
            <Tabs.Trigger value="lan">{t("局域网 HTTP")}</Tabs.Trigger>
            <Tabs.Trigger value="tailscale">Tailscale HTTP</Tabs.Trigger>
            <Tabs.Trigger value="tailscaleHttps">Tailscale HTTPS</Tabs.Trigger>
          </Tabs.List>
          <div className="connection-code">
            {error ? (
              <p role="alert">{error}</p>
            ) : !links ? (
              <p role="status">{t("正在读取网络地址…")}</p>
            ) : url && accessCode ? (
              <Code key={url} url={url} label={label + t("连接二维码")} />
            ) : (
              <p role="status">
                {t("未检测到")}
                {label}
                {t("地址")}
              </p>
            )}
          </div>
        </Tabs.Root>
        {url && (
          <div className="connection-details">
            <div className="connection-row">
              <span className="connection-label">{t("连接地址")}</span>
              <a
                href={url}
                referrerPolicy="no-referrer"
                className="connection-link"
              >
                {t("访问链接")}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              <CopyButton key={url} url={url} />
            </div>
            {accessCode && (
              <div className="connection-row">
                <span className="connection-label">{t("访问码")}</span>
                <code className="connection-secret">{accessCode}</code>
                <CopyButton url={accessCode} label={t("复制访问码")} />
              </div>
            )}
          </div>
        )}
        <HomeScreenGuide />
      </DialogContent>
    </Dialog>
  );
}
