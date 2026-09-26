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
const responses = new Map();
let responseBytes = 0;
export async function api(url, body) {
  const credential = access;
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
              "Content-Type": "application/json",
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
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
  let x;
  if (r.status === 304 && cached) return structuredClone(cached.value);
  try {
    x = await r.json();
  } catch {
    throw Object.assign(Error(t("服务器响应异常（HTTP ") + r.status + "）"), {
      status: r.status,
    });
  }
  if (!r.ok)
    throw Object.assign(Error(x.error || t("连接失败")), {
      status: r.status,
    });
  const tag = r.headers.get("ETag");
  if (!body && tag && credential === access) {
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
