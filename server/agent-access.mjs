import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentConnections } from "./agent-connections.mjs";
import { validateInstances } from "./instances.mjs";

// Disable only Pokite access. Keep adapters alive so accepted work can finish.
export class AgentAccess {
  constructor({ adapters, agentNames, file, discover, create, prepare }) {
    Object.assign(this, {
      adapters,
      agentNames,
      file,
      discover,
      create,
      prepare,
    });
    this.connections = new AgentConnections(adapters);
  }
  async saved() {
    return fs
      .readFile(this.file, "utf8")
      .then(JSON.parse)
      .catch((error) => {
        if (error.code === "ENOENT") return { instances: [] };
        throw error;
      });
  }
  async discovery() {
    if (this.discoveryCache && Date.now() - this.discoveryCache.time < 10000)
      return this.discoveryCache.value;
    if (!this.discoveryPending)
      this.discoveryPending = this.discover()
        .then((value) => {
          this.discoveryCache = { time: Date.now(), value };
          return value;
        })
        .finally(() => {
          this.discoveryPending = null;
        });
    return this.discoveryPending;
  }
  async report() {
    const [report, saved] = await Promise.all([this.discovery(), this.saved()]);
    const candidates = [...report.candidates];
    for (const instance of saved.instances) {
      try {
        validateInstances([{ ...instance, enabled: true }]);
      } catch {
        continue;
      }
      if (!candidates.some((c) => c.id === instance.id))
        candidates.push(instance);
    }
    return {
      candidates: await Promise.all(
        candidates.map(async (c) => ({
          id: c.id,
          name: c.name || c.provider,
          enabled:
            !!this.adapters[c.id] &&
            this.adapters[c.id].pokiteEnabled !== false,
          canEnable:
            report.instances.some((i) => i.id === c.id) ||
            saved.instances.some((i) => i.id === c.id),
          ...(await this.connections.get(
            { ...c, ...saved.instances.find((i) => i.id === c.id) },
            report,
          )),
        })),
      ),
    };
  }
  async toggle(id, enabled, { configure = true } = {}) {
    if (typeof id !== "string" || typeof enabled !== "boolean")
      throw Object.assign(Error("Invalid agent setting"), { status: 400 });
    if (this.busy)
      throw Object.assign(Error("配置操作正在进行，请稍后重试"), {
        status: 409,
      });
    this.busy = true;
    try {
      const [report, saved] = await Promise.all([
        this.discover(),
        this.saved(),
      ]);
      const source =
        saved.instances.find((i) => i.id === id) ||
        report.instances.find((i) => i.id === id);
      if (!source) throw Object.assign(Error("Unknown agent"), { status: 404 });
      const instance = validateInstances([{ ...source, enabled: true }])[0];
      const previous = await fs.readFile(this.file, "utf8").catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      const next = {
        ...saved,
        instances: saved.instances.some((i) => i.id === id)
          ? saved.instances.map((i) => (i.id === id ? { ...i, enabled } : i))
          : [...saved.instances, { ...instance, enabled }],
      };
      // Persist before setup tools read the instance, but restore on any failure.
      await this.write(JSON.stringify(next, null, 2));
      let created;
      try {
        const notice =
          enabled && configure
            ? await this.prepare(
                instance,
                report.candidates.find((c) => c.id === id),
              )
            : "";
        const previousAdapter = this.adapters[id];
        if (
          enabled &&
          (!previousAdapter || (notice && previousAdapter.readOnly))
        )
          created = this.create(instance);
        if (created) {
          created.onChange = previousAdapter?.onChange;
          this.adapters[id] = created;
          // A read-only adapter has no accepted execution to interrupt.
          try {
            await previousAdapter?.close?.();
          } catch (error) {
            console.error("Retired read-only adapter:", error.message);
          }
        }
        if (this.adapters[id]) this.adapters[id].pokiteEnabled = enabled;
        this.agentNames[id] = instance.name;
        this.connections.cache.delete(id);
        return { ok: true, notice: notice || "" };
      } catch (error) {
        await created?.close?.();
        if (previous === null) await fs.rm(this.file, { force: true });
        else await this.write(previous);
        throw error;
      }
    } finally {
      this.busy = false;
    }
  }
  async write(value) {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = this.file + "." + randomUUID();
    try {
      await fs.writeFile(temporary, value, { mode: 0o600 });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}
