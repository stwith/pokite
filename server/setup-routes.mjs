import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { discoverMachineAsync } from "./discovery-async.mjs";
import { requireLocalAdmin } from "./local-admin.mjs";
import { validateInstances } from "./instances.mjs";
import { instanceConfigFile } from "./state-paths.mjs";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

export function installSetupRoutes(app, post) {
  let work;
  app.use("/api/setup", requireLocalAdmin);
  app.get("/api/setup/discovery", async (req, res) => {
    const report = await discoverMachineAsync();
    res.json({
      candidates: report.candidates,
      instances: report.instances,
    });
  });
  post("/api/setup/configure", async (req, res) => {
    if (work)
      throw Object.assign(Error("配置操作正在进行，请稍后重试"), {
        status: 409,
      });
    const { action } = req.body;
    if (!["save", "codex", "hermes"].includes(action))
      throw Object.assign(Error("Invalid setup action"), { status: 400 });
    work = (async () => {
      const report = await discoverMachineAsync();
      const file = instanceConfigFile();
      const current = await fs
        .readFile(file, "utf8")
        .then(JSON.parse)
        .catch((e) => {
          if (e.code === "ENOENT") return { instances: [] };
          throw e;
        });
      const merged = [...current.instances];
      for (const instance of report.instances)
        if (!merged.some((x) => x.id === instance.id)) merged.push(instance);
      validateInstances(merged);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.writeFile(
        file + ".tmp",
        JSON.stringify({ instances: merged }, null, 2),
        { mode: 0o600 },
      );
      await fs.rename(file + ".tmp", file);
      if (action === "codex")
        await exec(
          process.execPath,
          [path.join(root, "scripts/setup-codex-sharing.mjs"), "--enable"],
          { timeout: 60000, maxBuffer: 1024 * 1024 },
        );
      if (action === "hermes")
        await exec(
          process.execPath,
          [path.join(root, "scripts/setup-hermes-sharing.mjs")],
          { timeout: 60000, maxBuffer: 1024 * 1024 },
        );
      return { ok: true, restartRequired: true };
    })();
    try {
      res.json(await work);
    } catch (error) {
      console.error("Agent setup failed:", error.stack || error.message);
      throw Object.assign(Error("配置未完成，请查看电脑上的 Pokite 日志。"), {
        status: 503,
      });
    } finally {
      work = null;
    }
  });
}
