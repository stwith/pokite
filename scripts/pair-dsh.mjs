#!/usr/bin/env node
// Pair Pokite with a dsh 0.2 web server:
//   node scripts/pair-dsh.mjs [launch URL] [--instance <id>]
// Without a URL, the newest "dsh web: …?token=…" line in the instance's
// launchLog is used. The launch token is exchanged, never stored.
import { parseArgs } from "node:util";
import { loadInstances } from "../server/instances.mjs";
import { DshAuth } from "../server/dsh-auth.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { instance: { type: "string" } },
});
const candidates = loadInstances().filter(
  (x) => x.provider === "dsh" && (!values.instance || x.id === values.instance),
);
const instance = positionals[0]
  ? candidates.find(
      (x) => new URL(x.url).origin === new URL(positionals[0]).origin,
    )
  : candidates[0];
if (!instance)
  throw Error(
    "没有找到对应的 DeepSeek Harness 实例；请检查地址端口或 --instance",
  );
const auth = new DshAuth(instance.url, { launchLog: instance.launchLog });
const launchUrl = positionals[0] || auth.launchUrlFromLog();
if (!launchUrl)
  throw Error(
    "没有配对地址：请传入 dsh web 启动时打印的地址，或在实例配置里设置 launchLog",
  );
const { origin, expiresAt } = await auth.pair(launchUrl);
console.log(
  `已与 ${instance.name}（${origin}）配对，有效期至 ${new Date(expiresAt).toLocaleString()}`,
);
