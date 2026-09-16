import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { findExecutable } from "./machine-discovery.mjs";

export class Rpc extends EventEmitter {
  constructor(home, options = {}) {
    super();
    this.home = home;
    this.options = options;
    this.pending = new Map();
    this.seq = 0;
  }
  async connect() {
    if (this.ready) return this.ready;
    this.ready = this.open().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }
  async open() {
    const env = { ...process.env, ...this.options.env, CODEX_HOME: this.home };
    for (const k of Object.keys(env))
      if (k.startsWith("CODEX_") && k !== "CODEX_HOME") delete env[k];
    const binary = findExecutable("codex", {
      explicit: this.options.binary || process.env.CODEX_BIN,
    });
    if (!binary) throw Error("Codex executable not found; configure CODEX_BIN");
    this.proc = spawn(
      binary,
      this.options.args || ["app-server", "--listen", "stdio://"],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.proc.stderr.on("data", () => {});
    const fail = () => {
      this.ready = null;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("Agent connection closed"));
      }
      this.pending.clear();
      this.emit("disconnect");
    };
    this.proc.on("error", fail);
    this.proc.on("exit", fail);
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.id !== undefined && !m.method) {
        const p = this.pending.get(m.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(m.id);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      } else this.emit("message", m);
    });
    await this.request("initialize", {
      clientInfo: {
        name: "agent_pocket",
        title: "Pokite",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    this.proc.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  }
  request(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Agent request timed out: " + method));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async call(method, params) {
    await this.connect();
    return this.request(method, params);
  }
  respond(id, result) {
    this.proc?.stdin.write(JSON.stringify({ id, result }) + "\n");
  }
  close() {
    this.proc?.kill("SIGTERM");
  }
}
