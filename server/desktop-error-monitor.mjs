import fs from "node:fs/promises";
import path from "node:path";

export class DesktopErrorMonitor {
  constructor({ root, report, onAlert = () => {} }) {
    this.root = root;
    this.report = report;
    this.onAlert = onAlert;
    this.files = new Map();
    this.ready = false;
    this.running = null;
    this.startedAt = Date.now();
    this.lastAlert = 0;
  }
  async paths(directory = this.root, depth = 0) {
    const rows = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const row of rows) {
      const file = path.join(directory, row.name);
      if (row.isDirectory() && depth < 3)
        files.push(...(await this.paths(file, depth + 1)));
      else if (row.isFile() && row.name.endsWith(".log")) files.push(file);
    }
    return files;
  }
  tick() {
    if (this.running) return this.running;
    this.running = this.scan().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async scan() {
    let files;
    try {
      files = await this.paths();
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const current = new Set(files);
    for (const file of this.files.keys())
      if (!current.has(file)) this.files.delete(file);
    for (const file of files) {
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        continue;
      }
      let record = this.files.get(file);
      if (!record || record.ino !== stat.ino || record.offset > stat.size) {
        record = {
          ino: stat.ino,
          offset: this.ready ? 0 : stat.size,
          tail: "",
        };
        this.files.set(file, record);
      }
      if (record.offset === stat.size) continue;
      const handle = await fs.open(file, "r");
      try {
        // Bound each pass. Remaining appended data is picked up on the next tick.
        const buffer = Buffer.alloc(
          Math.min(stat.size - record.offset, 512 * 1024),
        );
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          record.offset,
        );
        record.offset += bytesRead;
        const lines = (
          record.tail + buffer.subarray(0, bytesRead).toString("utf8")
        ).split("\n");
        record.tail = lines.pop().slice(-65536);
        for (const line of lines) {
          if (
            !line.includes("[Composer] submit failed") ||
            !line.includes("App-server queued follow-up no longer exists")
          )
            continue;
          const time = line.match(/^\S+/)?.[0];
          if (
            !Number.isFinite(Date.parse(time)) ||
            Date.parse(time) < this.startedAt
          )
            continue;
          const event = {
            detectedAt: new Date().toISOString(),
            time,
            source: path.basename(file),
            error: "App-server queued follow-up no longer exists",
            followUp: line.match(/followUp=(\w+)/)?.[1] || null,
          };
          await fs.mkdir(path.dirname(this.report), {
            recursive: true,
            mode: 0o700,
          });
          try {
            if ((await fs.stat(this.report)).size > 256 * 1024)
              await fs.rename(this.report, this.report + ".previous");
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          await fs.appendFile(this.report, JSON.stringify(event) + "\n", {
            mode: 0o600,
          });
          if (Date.now() - this.lastAlert > 60000) {
            this.lastAlert = Date.now();
            this.onAlert(event);
          }
        }
      } finally {
        await handle.close();
      }
    }
    this.ready = true;
  }
  async close() {
    await this.running;
  }
}
