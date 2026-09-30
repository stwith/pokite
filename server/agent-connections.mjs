import fs from "node:fs/promises";
import { desktopCodeCreationStatus } from "./desktop-code-creation.mjs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { sharedProfile } from "./shared-config.mjs";
import { matchesProcessGeneration } from "./process-identity.mjs";
import {
  claudeCodeDiagnostics,
  remoteControlAccountNotice,
} from "./claude-code-diagnostics.mjs";

const disconnected = (notice = "请先启动电脑上的 Agent") => ({
  connected: false,
  notice,
});
async function reachable(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
  await response.body?.cancel();
  return response.ok;
}
export class AgentConnections {
  constructor(adapters, { probe, now = Date.now } = {}) {
    this.adapters = adapters;
    this.probe = probe || this.inspect.bind(this);
    this.now = now;
    this.cache = new Map();
    this.pending = new Map();
  }
  async get(instance, report) {
    const cached = this.cache.get(instance.id);
    const ttl = 45000;
    if (cached && this.now() - cached.time < ttl) return cached.value;
    let work = this.pending.get(instance.id);
    if (!work) {
      work = Promise.resolve()
        .then(() => this.probe(instance, report))
        .catch((error) =>
          disconnected(
            error.message?.includes("Safe Storage")
              ? "请在 Mac 上允许 Claude Safe Storage 钥匙串访问，然后重新连接。"
              : "连接不可用，请检查电脑上的 Agent",
          ),
        )
        .then((value) => {
          this.cache.set(instance.id, { time: this.now(), value });
          return value;
        })
        .finally(() => this.pending.delete(instance.id));
      this.pending.set(instance.id, work);
    }
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((resolve) => {
          timer = setTimeout(
            () => resolve(disconnected("连接检测超时，请稍后刷新")),
            3000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async inspect(instance, report) {
    const adapter = this.adapters[instance.id];
    switch (instance.provider) {
      case "codex": {
        const profile = sharedProfile(instance.id);
        if (!profile) return disconnected("请在电脑上启用 Codex 共享");
        const state = JSON.parse(await fs.readFile(profile.stateFile, "utf8"));
        return state.desktopReady &&
          state.home === instance.home &&
          matchesProcessGeneration(state) &&
          (await reachable(
            profile.endpoint.replace(/^ws:/, "http:") + "/readyz",
          ))
          ? { connected: true }
          : disconnected();
      }
      case "dsh":
        try {
          return (await (adapter?.reachable
            ? adapter.reachable()
            : reachable(instance.url)))
            ? { connected: true }
            : disconnected();
        } catch (error) {
          return disconnected(
            error.code === "DSH_PAIRING_REQUIRED"
              ? "DeepSeek Harness 需要配对：在电脑上运行 node scripts/pair-dsh.mjs"
              : undefined,
          );
        }
      case "penguin": {
        const lock = JSON.parse(
          await fs.readFile(
            path.join(instance.home, ".penguin/data/server.lock"),
            "utf8",
          ),
        );
        if (!Number.isInteger(lock.port) || lock.port < 1 || lock.port > 65535)
          return disconnected();
        return (await reachable(`http://127.0.0.1:${lock.port}`))
          ? { connected: true }
          : disconnected();
      }
      case "hermesDesktop": {
        if (!adapter) return disconnected();
        const clients = await adapter.connections();
        const checks = await Promise.allSettled(
          clients.map((client) => client.get("/api/plugins/pokite/sessions")),
        );
        return checks.some(
          (result) =>
            result.status === "fulfilled" &&
            [1, 2].includes(result.value.version),
        )
          ? { connected: true }
          : disconnected("请打开 Hermes Desktop 并确认共享插件已安装");
      }
      case "claude": {
        if (!report.tools?.claude)
          return disconnected("未找到 Claude Code CLI");
        const { stdout } = await exec(
          report.tools.claude,
          ["auth", "status", "--json"],
          { timeout: 2500, maxBuffer: 65536 },
        );
        return JSON.parse(stdout).loggedIn === true
          ? { connected: true, notice: "CLI 按需执行，无需保持终端运行" }
          : disconnected("请先在电脑上登录 Claude Code CLI");
      }
      case "claudeDesktop":
      case "claudeDesktopCode": {
        if (
          !report.apps?.some(
            (app) => app.provider === "claudeDesktop" && app.running,
          )
        )
          return disconnected("请先打开 Claude Desktop");
        if (!adapter) return disconnected("开启后检测连接");
        // Status must not enqueue profile/catalog requests behind real
        // messages in the single broker lane, so it reports what real reads
        // last saw. With nothing known to be wrong the agent counts as
        // connected: only problems are shown.
        const { cached: catalog, failure } = adapter.catalog;
        if (failure && failure.time >= (catalog?.time ?? 0))
          return disconnected(failure.message);
        if (instance.provider === "claudeDesktop") return { connected: true };
        let account;
        try {
          account = JSON.parse(
            await fs.readFile(path.join(instance.home, "config.json"), "utf8"),
          ).lastKnownAccountUuid;
        } catch {}
        // Remote Control state is only known from a recent session list.
        if (
          !catalog ||
          !account ||
          !catalog.scope.startsWith(account + ":") ||
          this.now() - catalog.time > 30 * 60000
        )
          return { connected: true };
        if (
          catalog.rows.some(
            (row) =>
              row.codeLocalId && row.native?.connection_status === "connected",
          )
        )
          return {
            connected: true,
            diagnostics: [
              (
                await desktopCodeCreationStatus(instance.home, {
                  organization: catalog.scope.slice(
                    catalog.scope.indexOf(":") + 1,
                  ),
                })
              ).notice,
            ],
          };
        const notes = await claudeCodeDiagnostics();
        return {
          ...disconnected(
            notes[0] ||
              "请在 Claude Desktop 的 Code 中开启会话的 Remote Control。",
          ),
          diagnostics: [...notes, remoteControlAccountNotice],
        };
      }
      default:
        return disconnected("尚未配置连接");
    }
  }
}
