import fs from "node:fs/promises";
import os from "node:os";
const token = (
  await fs.readFile(new URL("../.local/access-token", import.meta.url), "utf8")
).trim();
const base = "http://127.0.0.1:3230";
async function call(url, body) {
  const r = await fetch(base + "/api" + url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const x = await r.json();
  if (!r.ok) throw Error(x.error);
  return x;
}
const report = [];
for (const id of ["codex", "codex2", "penguin", "dsh"]) {
  try {
    const projects = await call("/" + id + "/projects");
    const p = projects.find((p) => p.path === os.homedir()) || projects[0];
    const result = await call("/" + id + "/sessions", {
      projectId: p.id,
      text: "这是手机会话接入测试。仅回复 POCKET_OK，不调用任何工具，不读写文件。",
      requestId: "smoke_" + id + "_" + Date.now(),
    });
    report.push({ agent: id, ...result });
    console.log(id, JSON.stringify(result));
  } catch (e) {
    report.push({ agent: id, error: e.message });
    console.log(id, e.message);
  }
}
await fs.writeFile(
  new URL("../.local/live-tests.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
