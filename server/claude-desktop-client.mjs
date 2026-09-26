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
  assertRoot() {
    if (
      path.resolve(this.root) !==
      path.join(os.homedir(), "Library/Application Support/Claude")
    )
      throw Object.assign(Error("仅支持当前用户的 Claude Desktop"), {
        status: 403,
        delivery: "not-sent",
      });
  }
  async identity() {
    this.assertRoot();
    const result = await this.broker.request("/api/oauth/profile");
    if (!safe(result.account) || !safe(result.organization))
      throw Object.assign(Error("Claude Desktop 账号信息不完整"), {
        status: 503,
      });
    return { account: result.account, organization: result.organization };
  }
  async request(route, options = {}) {
    this.assertRoot();
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
    this.assertRoot();
    return this.broker.request("/api/oauth/profile", {
      retryAuthorization: true,
    });
  }
  close() {
    return this.broker.close();
  }
}

// Cowork and Code use the same Desktop identity and native broker. Closing one
// adapter must not disconnect the other or create another authorization process.
const clients = new Map();
export function acquireDesktopClient(root) {
  const key = path.resolve(root);
  let entry = clients.get(key);
  if (!entry) {
    entry = { client: new ClaudeDesktopClient(root), refs: 0 };
    clients.set(key, entry);
  }
  entry.refs++;
  let closed = false;
  return {
    identity: (...args) => entry.client.identity(...args),
    request: (...args) => entry.client.request(...args),
    connect: (...args) => entry.client.connect(...args),
    close: async () => {
      if (closed) return;
      closed = true;
      if (--entry.refs === 0) {
        clients.delete(key);
        await entry.client.close();
      }
    },
  };
}
