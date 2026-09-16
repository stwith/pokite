export function parsePairingQR(value, origin) {
  let url;
  try { url = new URL(value); } catch { throw Error("这不是有效的 Pokite 连接二维码。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw Error("不支持此二维码地址。");
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  if (!token || !/^[a-zA-Z0-9_-]{16,256}$/.test(token))
    throw Error("二维码未包含有效访问码。");
  if (url.pathname !== "/" || url.search) throw Error("不是 Pokite 首页连接。");
  return { token, sameOrigin: url.origin === origin, origin: url.origin, url: url.href };
}

export async function acceptsPairingToken(token, request = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request("/api/agents", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    return Array.isArray(await response.json());
  } catch { return false; }
  finally { clearTimeout(timer); }
}

export async function decodePairingImage(file) {
  if (!file || !file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)
    throw Error("请选择小于 20 MB 的二维码图片。");
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("无法读取图片，请重新选择。"));
    reader.readAsDataURL(file);
  });
    const image = new Image();
    image.src = source;
    try { await image.decode(); }
    catch { throw Error("图片格式无法识别，请使用 PNG 或 JPEG 图片。"); }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { default: jsQR } = await import("jsqr");
    let zxing;
    // Screen photos often contain a tiny QR inside a much larger camera frame.
    const w = image.naturalWidth, h = image.naturalHeight;
    const regions = [
      [0, 0, w, h],
      ...[0.7, 0.45, 0.25].map(f => [w * (1-f)/2, h * (1-f)/2, w*f, h*f]),
      ...[[0,0],[0.5,0],[0,0.5],[0.5,0.5]].map(([x,y]) => [w*x,h*y,w/2,h/2]),
    ];
    for (const [x,y,width,height] of regions) {
      for (const limit of [1000, 2000]) {
        const scale = Math.min(2, limit / Math.max(width,height));
        canvas.width = Math.max(1, Math.round(width*scale));
        canvas.height = Math.max(1, Math.round(height*scale));
        ctx.drawImage(image,x,y,width,height,0,0,canvas.width,canvas.height);
        const pixels = ctx.getImageData(0,0,canvas.width,canvas.height);
        const qr = jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:"attemptBoth"});
        if (qr) return qr.data;
        zxing ??= await import("@zxing/library");
        const luminance = new Uint8ClampedArray(pixels.width * pixels.height);
        for (let i = 0; i < luminance.length; i++) {
          const p = i * 4;
          luminance[i] = (pixels.data[p] + 2 * pixels.data[p+1] + pixels.data[p+2]) / 4;
        }
        const reader = new zxing.QRCodeReader();
        for (const inverted of [false, true]) {
          const source = new zxing.RGBLuminanceSource(luminance, pixels.width, pixels.height);
          const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(inverted ? source.invert() : source));
          try {
            return reader.decode(bitmap, new Map([[zxing.DecodeHintType.TRY_HARDER, true]])).getText();
          } catch (error) {
            if (!(error instanceof zxing.NotFoundException || error instanceof zxing.ChecksumException || error instanceof zxing.FormatException)) throw error;
          } finally { reader.reset(); }
        }
        await new Promise(resolve => setTimeout(resolve,0));
      }
    }
    throw Error("暂时无法识别这张图片。可选择二维码截图，或复制电脑二维码下方的访问码，在这里粘贴连接。");
}
