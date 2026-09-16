import { useRef, useState } from "react";
import { Camera, ImagePlus, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { acceptsPairingToken, decodePairingImage, parsePairingQR } from "../lib/pairing-qr";

export function PairingScanner({ onConnect }) {
  const camera = useRef(null), library = useRef(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [target, setTarget] = useState(null);
  async function read(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true); setError(""); setTarget(null);
    try {
      const result = parsePairingQR(await decodePairingImage(file), location.origin);
      if (result.sameOrigin || await acceptsPairingToken(result.token)) await onConnect(result.token);
      else setTarget(result);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="pairing-scanner">
    <input ref={camera} hidden type="file" accept="image/*" capture="environment" onChange={read} aria-label="拍摄二维码图片" />
    <input ref={library} hidden type="file" accept="image/*" onChange={read} aria-label="选择二维码图片" />
    <div className="pairing-actions">
      <Button type="button" variant="outline" disabled={busy} onClick={() => camera.current.click()}>
        {busy ? <LoaderCircle className="spin" /> : <Camera />}拍摄二维码
      </Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => library.current.click()}><ImagePlus />选择图片</Button>
    </div>
    <p className="pairing-privacy">二维码图片仅在本机识别</p>
    {error && <p className="error" role="alert">{error}</p>}
    {target && <div className="connection-help"><p>二维码指向另一个地址：{target.origin}</p><Button type="button" onClick={() => location.assign(target.url)}>打开此地址</Button></div>}
  </div>;
}
