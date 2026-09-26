import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
export const coworkBrokerPath = () =>
  path.join(
    os.homedir(),
    "Library/Application Support/Pokite/Cowork/Pokite Cowork Access",
  );
async function verifyBroker(binary) {
  const { stdout } = await exec(binary, ["--version"], {
    timeout: 5000,
    maxBuffer: 1024,
  });
  if (stdout.trim() !== "pokite-cowork-broker 4")
    throw fail("请在电脑上运行 npm run setup:cowork 完成 Cowork 接入");
}
const fail = (message, delivery = "not-sent", status = 503) =>
  Object.assign(Error(message), { delivery, status });
export class CoworkBroker {
  constructor({
    binary = coworkBrokerPath(),
    launch = spawn,
    verify = verifyBroker,
    timeout = 120000,
  } = {}) {
    Object.assign(this, { binary, launch, timeout, verify });
    this.pending = new Map();
  }
  async start() {
    if (this.closed) throw fail("Cowork 连接已关闭");
    if (this.child) return;
    await fs.access(this.binary).catch(() => {
      throw fail(
        "请在电脑上运行 npm run setup:cowork 完成 Cowork 接入",
        "not-sent",
        503,
      );
    });
    await this.verify(this.binary);
    if (this.closed) throw fail("Cowork 连接已关闭");
    if (this.child) return;
    const child = this.launch(this.binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.child = child;
    // Native errors contain status only. Never relay arbitrary child stderr to logs.
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (line.length > 24 * 1024 * 1024) {
        child.kill();
        return;
      }
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        child.kill();
        return;
      }
      if (response.event === "started") {
        const entry = this.pending.get(response.id);
        if (entry?.child === child) entry.started = true;
        return;
      }
      if (response.event === "authorization") {
        this.authorizationWaiting = response.waiting === true;
        clearTimeout(this.authorizationTimer);
        if (this.authorizationWaiting) {
          this.authorizationWaitingAt = Date.now();
          this.authorizationTimer = setTimeout(() => {
            if (!this.authorizationWaiting) return;
            for (const [id, pending] of this.pending) {
              if (
                pending.child === child &&
                pending.method === "GET" &&
                !pending.retryAuthorization
              ) {
                clearTimeout(pending.timer);
                this.pending.delete(id);
                pending.reject(
                  fail(
                    "正在等待 Mac 上的 Claude Safe Storage 授权，请允许后刷新。",
                  ),
                );
              }
            }
          }, 1500);
        }
        return;
      }
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error) {
        const message = response.error.message.startsWith(
          "Claude Safe Storage authorization required",
        )
          ? "请在 Mac 上允许 Claude Safe Storage 钥匙串访问，然后重新连接。"
          : response.error.message;
        pending.reject(
          fail(message, response.error.delivery, response.error.status),
        );
      } else pending.resolve(response.result);
    });
    const ended = () => {
      lines.close();
      if (this.child === child) {
        this.child = null;
        this.authorizationWaiting = false;
        clearTimeout(this.authorizationTimer);
      }
      for (const [id, pending] of this.pending) {
        if (pending.child !== child) continue;
        clearTimeout(pending.timer);
        pending.reject(
          fail(
            "Cowork 本机连接中断，请核对原会话",
            pending.started && pending.method !== "GET"
              ? "unknown"
              : "not-sent",
          ),
        );
        this.pending.delete(id);
      }
    };
    child.once("error", ended);
    child.once("close", ended);
  }
  async request(
    route,
    { method = "GET", body, scope, retryAuthorization = false } = {},
  ) {
    await this.start();
    if (
      this.authorizationWaiting &&
      Date.now() - this.authorizationWaitingAt >= 1500 &&
      !retryAuthorization
    )
      throw fail("正在等待 Mac 上的 Claude Safe Storage 授权，请允许后刷新。");
    if (this.pending.size >= 32) throw fail("Cowork 请求较多，请稍后重试");
    const id = randomUUID(),
      data = JSON.stringify({
        id,
        route,
        method,
        body,
        scope,
        retryAuthorization,
      });
    if (Buffer.byteLength(data) > 512 * 1024)
      throw fail("Cowork 请求过长", "not-sent", 400);
    return new Promise((resolve, reject) => {
      const child = this.child;
      const entry = {
        method,
        resolve,
        reject,
        started: false,
        retryAuthorization,
        child,
      };
      entry.timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          fail(
            "Cowork 请求超时；请检查 Mac 上的授权提示或原会话",
            entry.started && method !== "GET" ? "unknown" : "not-sent",
          ),
        );
        // Detach the doomed process immediately: no new request may be queued
        // onto it between timeout and the close event.
        if (this.child === child) this.child = null;
        child.kill();
      }, this.timeout);
      this.pending.set(id, entry);
      child.stdin.write(data + "\n", (error) => {
        if (error && this.pending.delete(id)) {
          clearTimeout(entry.timer);
          reject(
            fail(
              "Cowork 请求未能完整发送",
              entry.started && method !== "GET" ? "unknown" : "not-sent",
            ),
          );
        }
      });
    });
  }
  async close() {
    this.closed = true;
    clearTimeout(this.authorizationTimer);
    this.child?.stdin.end();
    this.child?.kill();
  }
}
