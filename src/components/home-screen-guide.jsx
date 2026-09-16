import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";

export function HomeScreenGuide() {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(media.matches || navigator.standalone === true);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  if (standalone) return null;
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return (
    <details className="home-screen-guide">
      <summary><Smartphone size={16} aria-hidden="true" />添加到主屏幕</summary>
      <p>{apple
        ? "在 Safari 中打开，点分享 → 添加到主屏幕；如有“作为 Web App 打开”，保持开启。"
        : "在手机浏览器菜单中选择“添加到主屏幕”。当前 HTTP 地址可能只支持快捷方式，取决于浏览器。"}</p>
      <p>先完成连接再添加。独立窗口若要求访问码，重新配对即可；电脑需保持开机并运行 Pokite。</p>
    </details>
  );
}
