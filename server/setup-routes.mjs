import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { discoverMachineAsync } from "./discovery-async.mjs";
import { requireLocalAdmin } from "./local-admin.mjs";
import { instanceConfigFile } from "./state-paths.mjs";
import { makeAdapters } from "./adapters.mjs";
import { AgentAccess } from "./agent-access.mjs";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
export function installSetupRoutes(app, post, { adapters, agentNames }) {
  const access = new AgentAccess({
    adapters,
    agentNames,
    file: instanceConfigFile(),
    discover: discoverMachineAsync,
    create: (instance) => makeAdapters([instance])[instance.id],
    prepare: async (instance, candidate) => {
      let script,
        args = [];
      if (
        instance.provider === "codex" &&
        candidate?.status === "needs-desktop-connection"
      ) {
        script = "setup-codex-sharing.mjs";
        args = ["--enable", "--instance", instance.id];
      }
      if (instance.provider === "hermesDesktop") {
        const installed = await fs
          .access(path.join(instance.home, "plugins/pokite/plugin.yaml"))
          .then(
            () => true,
            () => false,
          );
        if (!installed) script = "setup-hermes-sharing.mjs";
      }
      if (
        instance.provider === "claudeDesktop" &&
        candidate?.status === "cowork-broker-missing"
      )
        script = "setup-cowork.mjs";
      if (!script) return "";
      await exec(
        process.execPath,
        [path.join(root, "scripts", script), ...args],
        {
          timeout: script === "setup-cowork.mjs" ? 210000 : 60000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            ...(instance.provider === "hermesDesktop"
              ? { HERMES_HOME: instance.home }
              : {}),
          },
        },
      );
      return instance.provider === "claudeDesktop"
        ? "首次连接时，请在 Mac 上允许 Cowork 的钥匙串访问。"
        : "请等任务结束后，重新打开对应的 Desktop。";
    },
  });
  app.use("/api/setup", requireLocalAdmin);
  app.get("/api/setup/discovery", async (req, res) =>
    res.json(await access.report()),
  );
  post("/api/setup/toggle", async (req, res) => {
    try {
      res.json(await access.toggle(req.body.instanceId, req.body.enabled));
    } catch (error) {
      console.error("Agent setup failed:", error.stack || error.message);
      if (error.status) throw error;
      throw Object.assign(Error("配置未完成，请查看电脑上的 Pokite 日志。"), {
        status: 503,
      });
    }
  });
}
