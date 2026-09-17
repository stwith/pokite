import { useEffect, useRef, useState } from "react";
import { Tabs } from "radix-ui";
import { QrCode, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { api, getAccessToken } from "../lib/api";
import { HomeScreenGuide } from "./home-screen-guide";

function CopyLink({ url, label = "复制链接" }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const button = useRef(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    setError("");
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // LAN HTTP has no Clipboard API; keep the fallback inside the modal focus trap.
        const input = document.createElement("textarea");
        input.value = url;
        input.readOnly = true;
        input.style.cssText =
          "position:fixed;opacity:0;width:1px;height:1px;font-size:16px";
        button.current.parentElement.append(input);
        try {
          input.focus({ preventScroll: true });
          input.select();
          input.setSelectionRange(0, url.length);
          if (!document.execCommand("copy")) throw Error("copy failed");
        } finally {
          input.remove();
          button.current?.focus({ preventScroll: true });
        }
      }
      setCopied(true);
    } catch {
      setError("复制失败，请长按内容复制");
    }
  }
  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "已复制" : label}
        onClick={copy}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </Button>
      <span className="sr-only" role="status">
        {copied ? "已复制链接" : ""}
      </span>
      {error && (
        <span className="connection-copy-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

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
            color: { dark: "#171717", light: "#ffffff" },
          });
      })
      .catch(() => {
        if (alive) setError("二维码生成失败，请使用下方链接");
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
      return host.endsWith(".ts.net") ||
        (parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
        ? "tailscale" : "lan";
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
  const url = address
    ? address + "#token=" + encodeURIComponent(getAccessToken())
    : "";
  const label = mode === "lan" ? "局域网 HTTP" : "Tailscale HTTPS";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="connection-trigger"
          aria-label="连接手机"
        >
          <QrCode size={18} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="connection-title">连接手机或平板</DialogTitle>
        <DialogDescription className="connection-description">
          {mode === "lan" ? "手机与电脑连接同一局域网，然后扫码连接。" : "手机与电脑连接同一 Tailscale 网络，然后扫码连接。"}
        </DialogDescription>
        <Tabs.Root value={mode} onValueChange={setMode}>
          <Tabs.List className="connection-tabs" aria-label="连接网络">
            <Tabs.Trigger value="lan">局域网 HTTP</Tabs.Trigger>
            <Tabs.Trigger value="tailscale">Tailscale HTTPS</Tabs.Trigger>
          </Tabs.List>
          <div className="connection-code">
            {error ? (
              <p role="alert">{error}</p>
            ) : !links ? (
              <p role="status">正在读取网络地址…</p>
            ) : url ? (
              <Code key={url} url={url} label={label + "连接二维码"} />
            ) : (
              <p role="status">未检测到{label}地址</p>
            )}
          </div>
        </Tabs.Root>
        {url && <div className="connection-details">
          <div className="connection-row">
            <span className="connection-label">连接地址</span>
            <a href={url} referrerPolicy="no-referrer" className="connection-link">访问链接<ExternalLink size={14} aria-hidden="true" /></a>
            <CopyLink key={url} url={url} />
          </div>
          <div className="connection-row">
            <span className="connection-label">访问码</span>
            <code className="connection-secret">{getAccessToken()}</code>
            <CopyLink url={getAccessToken()} label="复制访问码" />
          </div>
        </div>}
        <HomeScreenGuide />
      </DialogContent>
    </Dialog>
  );
}
