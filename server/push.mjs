import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import webpush from "web-push";

const bad = (text) => Object.assign(new Error(text), { status: 400 });
export function validateSubscription(value) {
  let url;
  try {
    url = new URL(value?.endpoint);
  } catch {
    throw bad("无效的通知订阅");
  }
  const allowed =
    url.hostname === "fcm.googleapis.com" ||
    url.hostname === "updates.push.services.mozilla.com" ||
    /^(?:[a-z0-9-]+\.)*push\.apple\.com$/.test(url.hostname);
  if (
    !allowed ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.href.length > 4096
  )
    throw bad("不支持的推送服务地址");
  const { p256dh, auth } = value.keys || {};
  if (
    typeof p256dh !== "string" ||
    !/^[\w-]+={0,2}$/.test(p256dh) ||
    Buffer.from(p256dh, "base64url").length !== 65 ||
    typeof auth !== "string" ||
    !/^[\w-]+={0,2}$/.test(auth) ||
    Buffer.from(auth, "base64url").length !== 16
  )
    throw bad("无效的通知订阅密钥");
  return { endpoint: url.href, keys: { p256dh, auth } };
}
const ms = (value) =>
  typeof value === "number"
    ? value < 1e12
      ? value * 1000
      : value
    : Date.parse(value) || 0;
const keyOf = (value) => createHash("sha256").update(value).digest("hex");

export function completion(detail, since) {
  if (detail.executionIssue?.retrying) return null;
  if (
    detail.offline ||
    ["running", "waiting", "unknown", "interrupted"].includes(detail.status)
  )
    return null;
  if (
    (detail.executionIssue && !detail.executionIssue.retrying) ||
    detail.status === "failed"
  )
    return "failed";
  const messages = detail.messages || [];
  const user = messages.findLastIndex((m) => m.role === "user");
  const answer = messages.findLastIndex(
    (m) => m.role === "assistant" && m.text?.trim(),
  );
  if (answer < 0 || answer < user || ms(messages[answer].time) < since)
    return null;
  return "completed";
}

export class PushService {
  constructor(directory, adapters, options = {}) {
    this.file = path.join(directory, "push.json");
    this.adapters = adapters;
    this.send =
      options.send ||
      ((subscription, payload) =>
        webpush.sendNotification(subscription, JSON.stringify(payload), {
          vapidDetails: {
            subject: "https://github.com/stwith/pokite",
            ...this.state.vapid,
          },
          TTL: 3600,
          timeout: 10000,
          urgency: "normal",
        }));
    this.state = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : {
          vapid: webpush.generateVAPIDKeys(),
          devices: {},
          groups: {},
          outbox: [],
        };
    this.save();
  }
  save() {
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.state), {
      mode: 0o600,
    });
    fs.renameSync(this.file + ".tmp", this.file);
  }
  config() {
    return { publicKey: this.state.vapid.publicKey };
  }
  device(subscription) {
    return this.state.devices[keyOf(subscription?.endpoint || "")];
  }
  status(endpoint) {
    const d = this.device({ endpoint });
    return {
      enabled: !!d,
      projects: d?.projects || [],
      lastAttempt: d?.lastAttempt || null,
    };
  }
  async subscribe(subscription, origin, agent, projectId) {
    const clean = validateSubscription(subscription);
    if (!origin.startsWith("https://")) throw bad("请通过 HTTPS 开启通知");
    const adapter = this.adapters[agent];
    if (!adapter || !(await adapter.projects()).some((p) => p.id === projectId))
      throw bad("请先选择已有项目");
    const id = keyOf(clean.endpoint);
    if (!this.state.devices[id] && Object.keys(this.state.devices).length >= 20)
      throw bad("通知设备已达上限");
    const old = this.state.devices[id];
    if (old && old.origin !== origin) throw bad("通知订阅来源不一致");
    const projects = [...(old?.projects || [])];
    if (!projects.some((p) => p.agent === agent && p.projectId === projectId)) {
      if (projects.length >= 20) throw bad("每台设备最多关注 20 个项目");
      projects.push({ agent, projectId });
    }
    // Baseline is established before enabling delivery; existing finished tasks
    // are never interpreted as new completions.
    const groupKey = keyOf(JSON.stringify([agent, projectId]));
    if (!this.state.groups[groupKey]) {
      const rows = await adapter.sessions(projectId, { limit: 100 });
      this.state.groups[groupKey] = {
        agent,
        projectId,
        since: Date.now(),
        rows: Object.fromEntries(
          rows
            .slice(0, 500)
            .map((s) => [
              s.id,
              {
                revision: s.revision,
                checkedAt: Date.now(),
                running: s.status === "running",
              },
            ]),
        ),
      };
    }
    this.state.devices[id] = { ...old, subscription: clean, origin, projects };
    this.save();
    return this.status(clean.endpoint);
  }
  remove(endpoint, project) {
    const id = keyOf(endpoint || "");
    const d = this.state.devices[id];
    if (d && project)
      d.projects = d.projects.filter(
        (p) => p.agent !== project.agent || p.projectId !== project.projectId,
      );
    else delete this.state.devices[id];
    for (const [key, group] of Object.entries(this.state.groups))
      if (
        !Object.values(this.state.devices).some((d) =>
          d.projects.some(
            (p) => p.agent === group.agent && p.projectId === group.projectId,
          ),
        )
      )
        delete this.state.groups[key];
    this.save();
    return { ok: true };
  }
  async test(endpoint) {
    const device = this.device({ endpoint });
    if (!device) throw bad("请先开启本设备通知");
    if (Date.now() - (device.testAt || 0) < 10000)
      throw bad("请稍候再发送测试通知");
    device.testAt = Date.now();
    this.save();
    await this.deliver(device, {
      title: "Pokite 通知已连接",
      body: "点击返回 Pokite。任务完成后会在这里提醒你。",
      tag: "pokite-test",
      url: device.origin + "/",
    });
    return { ok: true, message: "推送服务已接收，请检查手机通知。" };
  }
  async deliver(device, payload) {
    try {
      await this.send(device.subscription, payload);
      device.lastAttempt = { at: Date.now(), accepted: true };
    } catch (e) {
      device.lastAttempt = {
        at: Date.now(),
        accepted: false,
        status: e.statusCode || 0,
      };
      if ([404, 410].includes(e.statusCode))
        this.remove(device.subscription.endpoint);
      throw Object.assign(new Error("推送服务暂未接收通知，请稍后重试。"), {
        status: 503,
      });
    } finally {
      this.save();
    }
  }
  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), 5000);
    this.timer.unref?.();
  }
  async tick() {
    if (this.work) return this.work;
    this.work = this.run().finally(() => {
      this.work = null;
    });
    return this.work;
  }
  async run() {
    for (const group of Object.values(this.state.groups)) {
      const adapter = this.adapters[group.agent];
      if (!adapter) continue;
      try {
        const rows = (
          await adapter.sessions(group.projectId, { limit: 100 })
        ).slice(0, 500);
        for (const row of rows) {
          const old = group.rows[row.id];
          const now = Date.now();
          const active = ["running", "waiting"].includes(row.status);
          let pendingCompletion = false;
          if (
            !active &&
            (old?.running ||
              (old && row.revision !== old.revision) ||
              (!old && ms(row.updatedAt) > group.since))
          ) {
            const detail = await adapter.detail(row.id);
            const result = completion(detail, old?.checkedAt || group.since);
            pendingCompletion =
              !result &&
              !!old?.running &&
              detail.status !== "interrupted" &&
              now - old.checkedAt < 600000;
            if (result) {
              for (const [deviceId, d] of Object.entries(this.state.devices)) {
                if (
                  !d.projects.some(
                    (p) =>
                      p.agent === group.agent &&
                      p.projectId === group.projectId,
                  )
                )
                  continue;
                const eventId = keyOf(
                  JSON.stringify([
                    deviceId,
                    group.agent,
                    row.id,
                    detail.revision,
                    result,
                  ]),
                );
                if (this.state.outbox.some((e) => e.id === eventId)) continue;
                const query = new URLSearchParams({
                  agent: group.agent,
                  project: group.projectId,
                  session: row.id,
                });
                this.state.outbox.push({
                  id: eventId,
                  deviceId,
                  createdAt: now,
                  attempts: 0,
                  payload: {
                    title: `${adapter.name || group.agent} · ${result === "failed" ? "任务失败" : "任务完成"}`,
                    body: "点击查看对应会话",
                    tag: "pokite-" + keyOf(group.agent + row.id).slice(0, 24),
                    url: d.origin + "/?" + query,
                  },
                });
              }
            }
          }
          group.rows[row.id] = {
            revision: row.revision,
            running: active || pendingCompletion,
            checkedAt:
              (active || pendingCompletion) && old?.running
                ? old.checkedAt
                : now,
          };
        }
        const ids = new Set(rows.map((r) => r.id));
        for (const id of Object.keys(group.rows))
          if (!ids.has(id)) delete group.rows[id];
      } catch {
        /* One unavailable agent must not block other projects. */
      }
    }
    this.state.outbox = this.state.outbox
      .filter((e) => Date.now() - e.createdAt < 3600000)
      .slice(-1000);
    this.save();
    for (const event of this.state.outbox) {
      if (
        event.done ||
        event.attempts >= 3 ||
        Date.now() < (event.retryAt || 0)
      )
        continue;
      const device = this.state.devices[event.deviceId];
      if (!device) {
        event.done = true;
        continue;
      }
      event.attempts++;
      event.retryAt = Date.now() + 30000 * event.attempts;
      this.save();
      try {
        await this.deliver(device, event.payload);
        event.done = true;
      } catch {}
      this.save();
    }
  }
  async close() {
    clearInterval(this.timer);
    await this.work;
  }
}
