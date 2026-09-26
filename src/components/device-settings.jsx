import { t } from "../lib/i18n.js";
import { useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";
import { api } from "../lib/api";
export function DeviceSettings() {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try {
      setRows(await api("/auth/devices"));
    } catch (e) {
      setError(e.message);
    }
  }
  async function revoke(row) {
    setBusy(true);
    try {
      await api("/auth/revoke", {
        id: row.id,
      });
      if (row.current) location.reload();
      else await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))
    return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("已连接设备")}>
          <MonitorSmartphone size={18} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="connection-title">
          {t("已连接设备")}
        </DialogTitle>
        <DialogDescription className="connection-description">
          {t("撤销后该设备无法继续访问。重新连接需要新的配对码。")}
        </DialogDescription>
        <div
          style={{
            maxHeight: "50vh",
            overflowY: "auto",
          }}
        >
          {rows.map((row) => (
            <div key={row.id} className="notification-setting">
              <span>
                {row.name}
                {row.current ? t(" · 当前设备") : ""}
              </span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => revoke(row)}
              >
                {t("撤销")}
              </Button>
            </div>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
