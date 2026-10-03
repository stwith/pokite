import { t, locale } from "./i18n.js";
import { browserStorage as storage } from "./browser-storage.js";
let initial;
export function captureAccessToken() {
  const ticket = new URLSearchParams(location.hash.slice(1)).get("token");
  if (!ticket) return false;
  initial = ticket;
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}
captureAccessToken();
let access = storage.getItem("access-token") || initial || "";
export function takeInitialAccessToken() {
  const value = initial;
  initial = null;
  return value;
}
const requests = new Set();
export function rejectAccessToken(credential) {
  if (!credential || credential !== access) return;
  access = "";
  if (storage.getItem("access-token") === credential)
    storage.removeItem("access-token");
  responses.clear();
  responseBytes = 0;
  for (const controller of requests) controller.abort();
  window.dispatchEvent(new Event("pokite:auth-expired"));
}
const responses = new Map();
let responseBytes = 0;
export async function api(url, body, { binary = false } = {}) {
  const credential = access;
  if (!credential)
    throw Object.assign(Error(t("请输入访问码")), { status: 401 });
  const controller = new AbortController();
  requests.add(controller);
  if (body) {
    responses.clear();
    responseBytes = 0;
  }
  const cached = !body && responses.get(url);
  let r;
  try {
    r = await fetch("/api" + url, {
      method: body ? "POST" : "GET",
      headers: {
        "Accept-Language": locale,
        Authorization: "Bearer " + access,
        ...(cached
          ? {
              "If-None-Match": cached.tag,
            }
          : {}),
        ...(body
          ? {
              "Content-Type": binary
                ? "application/octet-stream"
                : "application/json",
            }
          : {}),
      },
      body: body ? (binary ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(url.startsWith("/setup/") || binary ? 240000 : 60000),
      ]),
    });
  } catch (e) {
    requests.delete(controller);
    throw Object.assign(
      Error(
        e.name === "TimeoutError"
          ? t("请求超时，请检查网络连接")
          : t("网络请求失败，请检查与 Mac 的连接"),
      ),
      {
        transport: true,
        cause: e,
      },
    );
  }
  requests.delete(controller);
  let x;
  if (credential !== access)
    throw Object.assign(Error(t("请输入访问码")), { status: 401 });
  if (r.status === 304 && cached) return structuredClone(cached.value);
  try {
    x = await r.json();
  } catch {
    throw Object.assign(Error(t("服务器响应异常（HTTP ") + r.status + "）"), {
      status: r.status,
    });
  }
  if (credential !== access)
    throw Object.assign(Error(t("请输入访问码")), { status: 401 });
  if (r.status === 401 && x.code === "ACCESS_REJECTED")
    rejectAccessToken(credential);
  if (!r.ok)
    throw Object.assign(Error(x.error || t("连接失败")), {
      status: r.status,
    });
  const tag = r.headers.get("ETag");
  if (!body && tag && credential === access && !url.includes("/files/")) {
    const bytes = JSON.stringify(x).length * 2;
    if (bytes <= 8 * 1024 * 1024) {
      responseBytes -= responses.get(url)?.bytes || 0;
      responses.delete(url);
      responses.set(url, {
        tag,
        value: structuredClone(x),
        bytes,
      });
      responseBytes += bytes;
      while (responses.size > 24 || responseBytes > 8 * 1024 * 1024) {
        const oldest = responses.keys().next().value;
        responseBytes -= responses.get(oldest).bytes;
        responses.delete(oldest);
      }
    }
  }
  return x;
}
export const getAccessToken = () => access;
export const setAccessToken = (token) => {
  responses.clear();
  responseBytes = 0;
  access = token;
};
export const persistAccessToken = () => storage.setItem("access-token", access);
