import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CoworkBroker } from "./cowork-broker.mjs";
const safe = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
export class ClaudeDesktopClient {
  constructor(root, { broker = new CoworkBroker() } = {}) {
    this.root = root;
    this.broker = broker;
  }
  async identity() {
    const config = JSON.parse(
      await fs.readFile(path.join(this.root, "config.json"), "utf8"),
    );
    const account = config.lastKnownAccountUuid;
    if (!safe(account))
      throw Object.assign(Error("请先登录 Claude Desktop。"), { status: 401 });
    const orgs = (
      await fs
        .readdir(path.join(this.root, "local-agent-mode-sessions", account), {
          withFileTypes: true,
        })
        .catch(() => [])
    ).filter((row) => row.isDirectory() && safe(row.name));
    if (orgs.length !== 1)
      throw Object.assign(Error("无法唯一确认 Claude Desktop 当前组织。"), {
        status: 409,
      });
    return { account, organization: orgs[0].name };
  }
  async request(route, options = {}) {
    // Native broker is deliberately bound to the real user's Desktop store.
    if (
      path.resolve(this.root) !==
      path.join(os.homedir(), "Library/Application Support/Claude")
    )
      throw Object.assign(Error("Cowork 仅支持当前用户的 Claude Desktop"), {
        status: 403,
        delivery: "not-sent",
      });
    const identity = await this.identity();
    const scope = identity.account + ":" + identity.organization;
    if (options.scope && options.scope !== scope)
      throw Object.assign(Error("Claude 账号已切换，请刷新会话。"), {
        status: 409,
        delivery: "not-sent",
      });
    return this.broker.request(route, { ...options, scope });
  }
  connect() {
    return this.request("/api/oauth/profile", { retryAuthorization: true });
  }
  close() {
    return this.broker.close();
  }
}
