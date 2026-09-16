import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DesktopErrorMonitor } from "../server/desktop-error-monitor.mjs";
test("monitor ignores old errors and records new complete lines without conversation text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-monitor-"));
  try {
    const logs = path.join(root, "logs"),
      report = path.join(root, "events.jsonl"),
      alerts = [];
    await fs.mkdir(logs);
    const file = path.join(logs, "desktop.log");
    const line = () =>
      new Date().toISOString() +
      ' error [Composer] submit failed errorMessage="App-server queued follow-up no longer exists" followUp=local secret=DO_NOT_LOG\n';
    await fs.writeFile(file, line());
    const monitor = new DesktopErrorMonitor({
      root: logs,
      report,
      onAlert: (e) => alerts.push(e),
    });
    await monitor.tick();
    assert.equal(alerts.length, 0);
    const appended = line();
    await fs.appendFile(file, appended.slice(0, -1));
    await monitor.tick();
    assert.equal(alerts.length, 0);
    await fs.appendFile(file, "\n");
    await monitor.tick();
    await monitor.tick();
    assert.equal(alerts.length, 1);
    const contents = await fs.readFile(report, "utf8");
    assert.equal(contents.includes("DO_NOT_LOG"), false);
    assert.equal(contents.trim().split("\n").length, 1);
    await fs.appendFile(file, line());
    await monitor.tick();
    assert.equal(alerts.length, 1);
    assert.equal(
      (await fs.readFile(report, "utf8")).trim().split("\n").length,
      2,
    );
    await monitor.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
