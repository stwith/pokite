import fs from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
const decompress = promisify(gunzip);
const magic = Buffer.from([67, 76, 70, 2, 0, 154, 183, 226]);

// Observational only. Never change rollout gates, register an environment, or
// interpret the presence of bundled code as authorization to start a session.
// IDs below were verified against Desktop 2.9939.2; other versions fail unknown.
export async function desktopCodeCreationStatus(
  root,
  {
    organization,
    now = Date.now(),
    infoFile = "/Applications/Claude.app/Contents/Info.plist",
  } = {},
) {
  const unknown = {
    state: "unknown",
    notice: "Desktop Code 新建会话尚未接通，已有会话仍可回复",
  };
  try {
    const info = await fs.readFile(infoFile, "utf8");
    if (
      !/<key>CFBundleShortVersionString<\/key>\s*<string>2\.9939\.2<\/string>/.test(
        info,
      )
    )
      return unknown;
    const file = await fs.readFile(path.join(root, "fcache"));
    if (file.length > 4 * 1024 * 1024 || !file.subarray(0, 8).equals(magic))
      return unknown;
    const cached = JSON.parse(
      await decompress(file.subarray(8), { maxOutputLength: 16 * 1024 * 1024 }),
    );
    if (
      (cached.orgUuid !== undefined && (!organization || cached.orgUuid !== organization)) ||
      cached.mode !== "1p" ||
      !Number.isFinite(cached.timestamp) ||
      now - cached.timestamp < 0 ||
      now - cached.timestamp > 86400000
    )
      return unknown;
    if (cached.features?.["1183214304"]?.on === false)
      return {
        state: "unavailable",
        notice: "当前 Claude Desktop 的远程新建功能未开放；已有会话仍可回复",
      };
    if (cached.features?.["1183214304"]?.on === true)
      return {
        state: "detected",
        notice: "检测到 Desktop 原生远程新建功能，仍需验证接收环境和创建接口",
      };
    return unknown;
  } catch {
    return unknown;
  }
}
