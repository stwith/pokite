import { matchesAccessToken } from "./access-token.mjs";
import { AccessThrottle, accessPeer } from "./access-throttle.mjs";
import { isLocalAdminRequest, requireLocalAdmin } from "./local-admin.mjs";
import os from "node:os";
import { createHash } from "node:crypto";
import { tailscaleHttpsLink } from "./network-links.mjs";
import { normalizeLocale, localizeResponse } from "../shared/i18n.mjs";

export function installHttpProtection(
  app,
  { token, getToken = () => token, getPort },
) {
  app.use((req, res, next) => {
    req.locale = normalizeLocale(req.headers["accept-language"]);
    res.set("Content-Language", req.locale);
    res.vary("Accept-Language");
    const original = res.json.bind(res);
    res.json = (value) => original(localizeResponse(value, req.locale));
    next();
  });
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
  app.use(async (req, res, next) => {
    let host;
    try {
      host = new URL("http://" + req.headers.host);
    } catch {
      return res.sendStatus(400);
    }
    const direct =
      localIPs().has(host.hostname) && Number(host.port) === getPort();
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, "");
    let expectedOrigin = "http://" + req.headers.host;
    if (!direct) {
      if (!["127.0.0.1", "::1"].includes(peer)) return res.sendStatus(403);
      const serve = await tailscaleHttpsLink(getPort());
      if (!serve || new URL(serve.url).host !== req.headers.host)
        return res.sendStatus(403);
      expectedOrigin = new URL(serve.url).origin;
      req.pokiteServe = true;
    }
    req.pokiteOrigin = expectedOrigin;
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    next();
  });
  const throttle = new AccessThrottle();
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const credential = (req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    const valid = () => matchesAccessToken(credential, getToken());
    const peer = accessPeer(req),
      local = isLocalAdminRequest(req);
    if (!valid()) {
      if (!local && throttle.blocked(peer))
        return res
          .status(429)
          .set("Retry-After", "60")
          .json({
            error: "尝试次数过多，请一分钟后重试",
            code: "ACCESS_RATE_LIMITED",
          });
      if (!local) throttle.failed(peer);
      return res
        .status(401)
        .json({ error: "请输入访问码", code: "ACCESS_REJECTED" });
    }
    if (!local) throttle.succeeded(peer);
    req.auth = { id: "shared" };
    if (
      (req.path.startsWith("/setup/") || req.path === "/auth/reset") &&
      !isLocalAdminRequest(req)
    )
      return requireLocalAdmin(req, res, next);
    if (req.headers.origin && req.headers.origin !== req.pokiteOrigin)
      return res.status(403).json({ error: "Cross-origin request rejected" });
    if (req.path.endsWith("/events")) {
      const timer = setInterval(() => {
        if (!valid()) res.end();
      }, 1000);
      timer.unref?.();
      res.on("close", () => clearInterval(timer));
    }
    next();
  });
}

export function installResponseHandling(app, events) {
  app.use("/api", (req, res, next) => {
    if (req.method === "GET") {
      res.json = (value) => {
        value = localizeResponse(value, req.locale);
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
