import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "./ui/button";
import { t } from "../lib/i18n.js";

export function CopyButton({ url, label = t("复制链接"), className }) {
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
          input.focus({
            preventScroll: true,
          });
          input.select();
          input.setSelectionRange(0, url.length);
          if (!document.execCommand("copy")) throw Error("copy failed");
        } finally {
          input.remove();
          button.current?.focus({
            preventScroll: true,
          });
        }
      }
      setCopied(true);
    } catch {
      setError(t("复制失败，请长按内容复制"));
    }
  }
  return (
    <>
      <Button
        className={className}
        ref={button}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? t("已复制") : label}
        onClick={copy}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </Button>
      <span className="sr-only" role="status">
        {copied ? t("已复制") : ""}
      </span>
      {error && (
        <span className="connection-copy-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
