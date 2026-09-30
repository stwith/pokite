import fs from "node:fs";
import path from "node:path";
import { stateFile } from "./state-paths.mjs";

// dsh 0.2 web prints "dsh web: http://host:port/?token=…" at startup. That
// launch token lives only as long as the process, but exchanging it once
// yields a cookie signed with the profile's persistent secret (30 days by
// default), which keeps working across dsh restarts.
const LAUNCH_LINE = /dsh web: (http:\/\/\S+?\?token=[A-Za-z0-9_-]+)/g;

export function pairingRequired(detail) {
  return Object.assign(
    Error(
      "DeepSeek Harness 需要配对" +
        (detail ? "（" + detail + "）" : "") +
        "：运行 node scripts/pair-dsh.mjs <dsh web 启动时打印的地址>，或在实例配置里用 launchLog 指向 dsh web 的启动日志。",
    ),
    { code: "DSH_PAIRING_REQUIRED", status: 503 },
  );
}

export class DshAuth {
  constructor(base, { file = stateFile("dsh-auth.json"), launchLog } = {}) {
    this.origin = new URL(base).origin;
    this.file = file;
    this.launchLog = launchLog;
  }
  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }
  write(all) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = this.file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(all, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  cookie() {
    const entry = this.read()[this.origin];
    return entry?.cookie && entry.expiresAt > Date.now() ? entry.cookie : null;
  }
  forget() {
    const all = this.read();
    if (!(this.origin in all)) return;
    delete all[this.origin];
    this.write(all);
  }
  async pair(launchUrl) {
    let url;
    try {
      url = new URL(launchUrl);
    } catch {
      throw Error("配对地址格式不对");
    }
    if (url.origin !== this.origin)
      throw Error(
        `配对地址 ${url.origin} 不是这个 DeepSeek Harness（${this.origin}）`,
      );
    if (!url.searchParams.get("token")) throw Error("配对地址缺少 token");
    let response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw Error("连不上 DeepSeek Harness：" + this.origin);
    }
    const setCookie = response.headers.getSetCookie?.()[0];
    if (response.status !== 303 || !setCookie)
      throw Error(
        "配对令牌无效或已过期（HTTP " +
          response.status +
          "）；dsh 重启后需要用新打印的地址",
      );
    const cookie = setCookie.split(";")[0].trim();
    const maxAge = Number(/;\s*Max-Age=(\d+)/i.exec(setCookie)?.[1]);
    const expires = Date.parse(/;\s*Expires=([^;]+)/i.exec(setCookie)?.[1]);
    const expiresAt = Number.isFinite(maxAge)
      ? Date.now() + maxAge * 1000
      : Number.isFinite(expires)
        ? expires
        : Date.now() + 24 * 3600 * 1000;
    const all = this.read();
    all[this.origin] = { cookie, expiresAt, pairedAt: Date.now() };
    this.write(all);
    return { origin: this.origin, expiresAt };
  }
  // Newest launch URL for this origin in the configured dsh web log, if any.
  launchUrlFromLog() {
    if (!this.launchLog) return null;
    let text;
    try {
      text = fs.readFileSync(this.launchLog, "utf8");
    } catch {
      return null;
    }
    const urls = [...text.matchAll(LAUNCH_LINE)]
      .map((match) => match[1])
      .filter((value) => {
        try {
          return new URL(value).origin === this.origin;
        } catch {
          return false;
        }
      });
    return urls.at(-1) ?? null;
  }
  // Re-pair from the launch log after a 401; concurrent callers share one try.
  recover() {
    this.recovering ??= (async () => {
      this.forget();
      const launchUrl = this.launchUrlFromLog();
      if (!launchUrl) return false;
      try {
        await this.pair(launchUrl);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      this.recovering = null;
    });
    return this.recovering;
  }
}
