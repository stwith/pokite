import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const keychainHelperPath = (home = os.homedir()) =>
  path.join(home, "Library/Application Support/Pokite/Keychain/Pokite Claude Access");

export async function readClaudeKeychain(signal, run = exec) {
  try {
    const { stdout } = await run(keychainHelperPath(), [], {
      timeout: 120000, maxBuffer: 16384, encoding: "buffer", signal,
    });
    if (!stdout.length) throw new Error("Empty credential");
    const key = Buffer.from(stdout);
    stdout.fill(0);
    return key;
  } catch (error) {
    // Child-process errors can contain captured stdout. Never propagate them.
    error.stdout?.fill?.(0);
    throw Object.assign(new Error(error.code === "ENOENT"
      ? "请先运行 node scripts/setup-claude-keychain.mjs，安装 Pokite 钥匙串工具。"
      : "请在 Mac 上允许 Pokite Claude Access 读取 Claude Safe Storage；选择始终允许可保存许可。"), { status: 503 });
  }
}
