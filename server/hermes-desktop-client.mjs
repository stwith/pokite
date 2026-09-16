import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const unavailable = () =>
  Object.assign(new Error("请先打开 Hermes Desktop，并在桌面打开一个会话。"), {
    delivery: "not-sent",
  });

// Inspect only same-user children of the native app. Never log process environments.
export async function discoverHermesBackends(home) {
  if (process.platform !== "darwin") throw unavailable();
  const run = async (file, args) => {
    try {
      return (
        await exec(file, args, { timeout: 3000, maxBuffer: 4 * 1024 * 1024 })
      ).stdout;
    } catch {
      return "";
    }
  };
  const rows = (await run("/bin/ps", ["-axo", "uid=,pid=,ppid=,comm="]))
    .split("\n")
    .flatMap((line) => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      return m
        ? [{ uid: +m[1], pid: +m[2], parent: +m[3], command: m[4] }]
        : [];
    })
    .filter((r) => r.uid === process.getuid());
  const parents = new Set(
    rows
      .filter((r) => /\/Hermes\.app\/Contents\/MacOS\/Hermes$/.test(r.command))
      .map((r) => r.pid),
  );
  const backends = [];
  for (const row of rows.filter(
    (r) => parents.has(r.parent) && /python/i.test(r.command),
  )) {
    const command = await run("/bin/ps", [
      "-ww",
      "-p",
      String(row.pid),
      "-o",
      "command=",
    ]);
    if (
      !/hermes_cli\.main\s+(?:--profile\s+\S+\s+)?(?:serve|dashboard)\b/.test(
        command,
      )
    )
      continue;
    const environment = await run("/bin/ps", [
      "eww",
      "-p",
      String(row.pid),
      "-o",
      "command=",
    ]);
    const token = environment.match(
      /(?:^| )HERMES_DASHBOARD_SESSION_TOKEN=([A-Za-z0-9_-]+)/,
    )?.[1];
    const root = environment
      .match(/(?:^| )HERMES_HOME=(.*?)(?= [A-Za-z_][A-Za-z0-9_]*=|$)/)?.[1]
      ?.trim();
    if (!token || root !== home) continue;
    const ports = await run("/usr/sbin/lsof", [
      "-nP",
      "-a",
      "-p",
      String(row.pid),
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fn",
    ]);
    const port = ports.match(/^n127\.0\.0\.1:(\d+)$/m)?.[1];
    if (port)
      backends.push({
        pid: row.pid,
        url: `http://127.0.0.1:${port}`,
        token,
        profile: command.match(/--profile\s+(\S+)/)?.[1] || "default",
      });
  }
  return backends;
}

export class HermesDesktopClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }
  async request(route, body) {
    let response;
    try {
      response = await fetch(this.endpoint.url + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "X-Hermes-Session-Token": this.endpoint.token,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        "Hermes Desktop 连接中断；若正在提交，请检查原会话，避免重复发送。",
      );
    }
    if (!response.ok) {
      const message =
        response.status === 404 && route.startsWith("/api/plugins/pokite/")
          ? "请安装 Pokite 的 Hermes 本地插件，并重新打开 Hermes Desktop。"
          : `Hermes Desktop 请求失败（HTTP ${response.status}）`;
      throw Object.assign(new Error(message), {
        status: response.status,
        ...(response.status === 409 ? { retrySafe: true } : {}),
      });
    }
    return response.json();
  }
  get(route) {
    return this.request(route);
  }
  post(route, body) {
    return this.request(route, body);
  }
  close() {}
}
