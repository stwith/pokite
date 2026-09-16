import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Agent, ProxyAgent, fetch } from "undici";
import {
  decryptDesktopCache,
  sessionCredential,
} from "./claude-desktop-credentials.mjs";
import { macHttpsProxy } from "./desktop-network.mjs";

const exec = promisify(execFile);
const safeId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
const failure = (message, status = 503) =>
  Object.assign(Error(message), { status });

export class ClaudeDesktopClient {
  constructor(root, options = {}) {
    this.root = root;
    this.keyWaitMs = options.keyWaitMs ?? 1500;
    this.lifecycle = new AbortController();
    this.readKey =
      options.readKey ||
      (async () => {
        try {
          const { stdout } = await exec(
            "/usr/bin/security",
            [
              "find-generic-password",
              "-s",
              "Claude Safe Storage",
              "-a",
              "Claude",
              "-w",
            ],
            {
              timeout: 120000,
              maxBuffer: 16384,
              encoding: "buffer",
              signal: this.lifecycle.signal,
            },
          );
          const end = stdout.at(-1) === 10 ? stdout.length - 1 : stdout.length;
          const key = Buffer.from(stdout.subarray(0, end));
          stdout.fill(0);
          return key;
        } catch {
          throw failure(
            "Claude 本机授权尚未完成，请在 Mac 上允许钥匙串访问后重新连接。",
          );
        }
      });
    this.fetcher = options.fetcher || fetch;
    this.network =
      options.network ||
      (async () => {
        if (process.platform !== "darwin")
          throw failure("Claude Desktop 远程接入目前支持 macOS。");
        const { stdout } = await exec("/usr/sbin/scutil", ["--proxy"], {
          encoding: "utf8",
        });
        const proxy = macHttpsProxy(stdout);
        return proxy ? new ProxyAgent(proxy) : new Agent();
      });
  }
  async identity() {
    const config = await fs
      .readFile(path.join(this.root, "config.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    const account = config?.lastKnownAccountUuid;
    if (!safeId(account)) throw failure("请先登录 Claude Desktop。", 401);
    const orgs = new Set();
    for (const kind of ["local-agent-mode-sessions", "claude-code-sessions"]) {
      for (const entry of await fs
        .readdir(path.join(this.root, kind, account), { withFileTypes: true })
        .catch(() => [])) {
        if (entry.isDirectory() && safeId(entry.name)) orgs.add(entry.name);
      }
    }
    if (orgs.size !== 1)
      throw failure("无法唯一确认 Claude Desktop 当前组织。", 409);
    return { account, organization: [...orgs][0], config };
  }
  async credentials() {
    if (this.closed) throw failure("Claude 连接已关闭。");
    const identity = await this.identity();
    this.keyPromise ||= this.readKey()
      .then((key) => {
        if (this.closed) {
          key.fill(0);
          throw failure("Claude 连接已关闭。");
        }
        this.key = key;
        return key;
      })
      .catch((error) => {
        this.keyFailed = true;
        throw error;
      });
    // macOS may wait for a human for two minutes. Keep that one request alive,
    // but tell the browser what is needed instead of blocking every list read.
    let timer;
    let key;
    try {
      key = await Promise.race([
        this.keyPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(failure(
            "正在等待 Mac 上的 Claude Safe Storage 钥匙串授权，请允许访问后重试。",
          )), this.keyWaitMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    const cache = decryptDesktopCache(
      identity.config["oauth:tokenCacheV2"] ||
        identity.config["oauth:tokenCache"],
      key,
    );
    let token;
    try {
      token = sessionCredential(cache, identity.account, identity.organization);
    } catch {
      throw failure(
        "Claude 登录凭据已过期或权限不可用，请在 Desktop 恢复登录。",
        401,
      );
    }
    return { ...identity, token };
  }
  async connect() {
    if (this.keyFailed) {
      this.keyPromise = null;
      this.keyFailed = false;
    }
    if (this.networkFailed) {
      const previous = await this.dispatcherPromise?.catch(() => null);
      await previous?.close();
      this.dispatcherPromise = null;
      this.preflightPromise = null;
      this.networkFailed = false;
    }
    return this.request("/api/oauth/profile").then(() => ({ ok: true }));
  }
  async request(route, { method = "GET", body, scope } = {}) {
    const progress = { submitted: false };
    try {
      if (this.closed) throw failure("Claude 连接已关闭。");
      return await this.performRequest(
        route,
        { method, body, scope },
        progress,
      );
    } catch (error) {
      if (!error.delivery)
        error.delivery = progress.submitted ? "unknown" : "not-sent";
      throw error;
    }
  }
  async performRequest(route, { method, body, scope }, progress) {
    if (
      !/^\/(?:api\/oauth\/profile|v1\/code\/sessions(?:[/?]|$))/.test(route) ||
      route.includes("..")
    )
      throw failure("Invalid Claude route", 400);
    this.dispatcherPromise ||= this.network();
    const dispatcher = await this.dispatcherPromise;
    this.preflightPromise ||= (async () => {
      const response = await this.fetcher(
        "https://api.anthropic.com/api/oauth/profile",
        {
          method: "GET",
          dispatcher,
          redirect: "error",
          signal: AbortSignal.any([
            this.lifecycle.signal,
            AbortSignal.timeout(15000),
          ]),
        },
      );
      await response.body?.cancel();
      if (response.status !== 401)
        throw failure("Claude 网络预检未通过，请检查 Mac 系统代理后重新连接。");
    })().catch((error) => {
      this.networkFailed = true;
      throw error;
    });
    await this.preflightPromise;
    const credential = await this.credentials();
    const identityKey = credential.account + ":" + credential.organization;
    if (scope && scope !== identityKey)
      throw failure("Claude 账号已切换，请刷新会话。", 409);
    const headers = {
      Authorization: `Bearer ${credential.token}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "ccr-byoc-2025-07-29",
      "anthropic-client-feature": "ccr",
      "anthropic-client-platform": "web_claude_ai",
      "x-organization-uuid": credential.organization,
    };
    const perform = async (target, verb, data) => {
      let response;
      try {
        if (verb !== "GET") progress.submitted = true;
        response = await this.fetcher("https://api.anthropic.com" + target, {
          method: verb,
          headers,
          dispatcher,
          redirect: "error",
          body: data === undefined ? undefined : JSON.stringify(data),
          signal: AbortSignal.any([
            this.lifecycle.signal,
            AbortSignal.timeout(20000),
          ]),
        });
      } catch {
        throw Object.assign(
          failure("Claude 网络连接中断，请核对会话后再操作。"),
          {
            delivery: verb === "GET" ? "not-sent" : "unknown",
          },
        );
      }
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of response.body || []) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) throw Error("size");
          chunks.push(chunk);
        }
      } catch {
        throw Object.assign(failure("Claude 响应未完整接收。"), {
          delivery: verb === "GET" ? "not-sent" : "unknown",
        });
      }
      if (!response.ok)
        throw Object.assign(
          failure(
            `Claude 请求未成功（HTTP ${response.status}）。`,
            response.status === 401 || response.status === 403 ? 401 : 503,
          ),
          { delivery: verb === "GET" ? "not-sent" : "unknown" },
        );
      try {
        return size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      } catch {
        throw Object.assign(failure("Claude 响应格式不兼容。"), {
          delivery: verb === "GET" ? "not-sent" : "unknown",
        });
      }
    };
    // Validate the server identity once per credential, before accessing history.
    if (this.verifiedToken !== credential.token) {
      const profile = await perform("/api/oauth/profile", "GET");
      if (
        profile.account?.uuid !== credential.account ||
        profile.organization?.uuid !== credential.organization
      )
        throw failure("Claude 账号校验不一致，已停止访问。", 409);
      this.verifiedToken = credential.token;
    }
    const before = await this.identity();
    if (before.account + ":" + before.organization !== identityKey)
      throw failure("Claude 账号已切换，请刷新会话。", 409);
    const result =
      route === "/api/oauth/profile"
        ? { ok: true }
        : await perform(route, method, body);
    const after = await this.identity();
    if (after.account + ":" + after.organization !== identityKey)
      throw Object.assign(
        failure("Claude 账号已切换，未显示旧账号结果。", 409),
        { delivery: method === "GET" ? "not-sent" : "unknown" },
      );
    return result;
  }
  async close() {
    this.closed = true;
    this.lifecycle.abort();
    this.key?.fill(0);
    this.key = null;
    this.verifiedToken = null;
    const dispatcher = await this.dispatcherPromise?.catch(() => null);
    await dispatcher?.close();
  }
}
