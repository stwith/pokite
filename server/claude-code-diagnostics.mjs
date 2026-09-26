import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Configuration hints, not account entitlement claims. Never return values of
// credential variables or modify the user's Desktop/CLI configuration.
export async function claudeCodeDiagnostics({
  home = os.homedir(),
  env = process.env,
} = {}) {
  let settings = {};
  try {
    settings = JSON.parse(
      await fs.readFile(path.join(home, ".claude/settings.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT")
      return ["Claude 配置无法读取，请检查 settings.json"];
  }
  const values = { ...env, ...settings.env };
  const notes = [];
  for (const key of [
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "DISABLE_GROWTHBOOK",
  ])
    if (["1", "true"].includes(String(values[key]).toLowerCase()))
      notes.push(
        `${key} 已开启，Remote Control 可能无法建立，请在电脑上检查配置`,
      );
  if (values.ANTHROPIC_BASE_URL) {
    try {
      if (new URL(values.ANTHROPIC_BASE_URL).hostname !== "api.anthropic.com")
        notes.push(
          "检测到自定义 API 地址；请确认 Desktop Code 实际使用官方服务",
        );
    } catch {
      notes.push("Claude API 地址格式无效");
    }
  }
  for (const key of [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ])
    if (["1", "true"].includes(String(values[key]).toLowerCase()))
      notes.push(
        "第三方云服务配置不支持 Remote Control，请核对 Desktop Code 配置",
      );
  if (values.ANTHROPIC_API_KEY || values.ANTHROPIC_AUTH_TOKEN)
    notes.push(
      "检测到 API 凭据配置；Remote Control 需要 Desktop 使用 Claude 订阅登录",
    );
  return notes;
}
export const remoteControlAccountNotice =
  "若仍未连接，请在 Desktop 检查订阅、组织 Remote Control 权限和数据保留策略；本地配置无法确认这些账号条件";
