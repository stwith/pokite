// A loopback proxy (including Tailscale Serve) is not a local administrator.
export function isLocalAdminRequest(req) {
  const peer = req.socket.remoteAddress?.replace(/^::ffff:/, "");
  let host;
  try {
    host = new URL("http://" + req.headers.host).hostname;
  } catch {
    return false;
  }
  return (
    ["127.0.0.1", "::1"].includes(peer) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(host) &&
    !Object.keys(req.headers).some((key) =>
      /^(forwarded|x-forwarded-|tailscale-)/i.test(key),
    )
  );
}
export function requireLocalAdmin(req, res, next) {
  if (!isLocalAdminRequest(req))
    return res
      .status(403)
      .json({ error: "请在电脑上通过 localhost 打开 Pokite 执行此操作" });
  next();
}
