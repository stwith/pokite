import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { browserStorage } from "../lib/browser-storage";
import { setAccessToken } from "../lib/api";

export function DisconnectDialog({ disabled }) {
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  function disconnect() {
    if (!browserStorage.removeItem("access-token")) {
      setError("浏览器未能清除访问码，请清除此站点的网站数据后退出。");
      return;
    }
    setAccessToken("");
    location.replace(location.pathname);
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="ghost" size="icon-sm" disabled={disabled} aria-label="退出连接"><LogOut size={18} /></Button></DialogTrigger>
    <DialogContent>
      <DialogTitle>退出此设备的连接？</DialogTitle>
      <DialogDescription>清除当前浏览器的访问码并返回首屏。电脑上的任务继续运行，其他设备不受影响。再次进入需要重新连接。</DialogDescription>
      {error && <p role="alert">{error}</p>}
      <div className="disconnect-actions"><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button onClick={disconnect}>退出连接</Button></div>
    </DialogContent>
  </Dialog>;
}
