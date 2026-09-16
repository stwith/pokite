import os from "node:os";
import { timingSafeEqual, createHash } from "node:crypto";

export function installHttpProtection(app, { token, getPort }) {
  const localIPs = () =>
    new Set([
      "127.0.0.1",
      "localhost",
      ...Object.values(os.networkInterfaces())
        .flat()
        .filter(Boolean)
        .filter((i) => i.family === "IPv4")
        .map((i) => i.address),
    ]);
  app.use((req, res, next) => {
    let host;
    try {
      host = new URL("http://" + req.headers.host);
    } catch {
      return res.sendStatus(400);
    }
    if (!localIPs().has(host.hostname) || Number(host.port) !== getPort())
      return res.sendStatus(403);
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    next();
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const got = Buffer.from(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      ),
      want = Buffer.from(token);
    if (got.length !== want.length || !timingSafeEqual(got, want))
      return res.status(401).json({ error: "请输入访问码" });
    if (
      req.headers.origin &&
      req.headers.origin !== "http://" + req.headers.host
    )
      return res.status(403).json({ error: "Cross-origin request rejected" });
    next();
  });
}

export function installResponseHandling(app, events) {
  app.use("/api", (req, res, next) => {
    if (req.method === "GET") {
      res.json = (value) => {
        const body = JSON.stringify(value);
        const tag =
          '"' + createHash("sha256").update(body).digest("base64url") + '"';
        res.set("ETag", tag);
        if (res.statusCode === 200 && req.headers["if-none-match"] === tag)
          return res.status(304).end();
        return res.type("json").send(body);
      };
    } else {
      const agent = req.path.split("/")[1];
      res.on("finish", () => {
        if (res.statusCode < 400) events.notify(agent);
      });
    }
    next();
  });
}
