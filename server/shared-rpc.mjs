import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { matchesProcessGeneration } from "./process-identity.mjs";

export class SharedRpc extends EventEmitter {
  constructor(url, options = {}) {
    super();
    const parsed = new URL(url);
    if (parsed.protocol !== "ws:" || parsed.hostname !== "127.0.0.1")
      throw Error("Shared Codex must use a loopback endpoint");
    this.url = url;
    this.options = options;
    this.pending = new Map();
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
    let token;
    try {
      if (this.options.stateFile) {
        const state = JSON.parse(
          await fs.readFile(this.options.stateFile, "utf8"),
        );
        if (
          !state.desktopReady ||
          state.home !== this.options.home ||
          state.endpoint !== this.url
        )
          throw Error("等待 Codex 桌面建立共享连接");
        process.kill(state.pid, 0);
        if (!matchesProcessGeneration(state))
          throw Error("Codex 共享进程已变化，请等待桌面重新连接");
      }
      token = this.options.tokenFile
        ? (await fs.readFile(this.options.tokenFile, "utf8")).trim()
        : null;
    } catch (e) {
      if (["ENOENT", "ESRCH"].includes(e.code))
        throw Object.assign(Error("等待 Codex 桌面建立共享连接"), {
          delivery: "not-sent",
          cause: e,
        });
      throw Object.assign(e, { delivery: "not-sent" });
    }
    const socket = new WebSocket(this.url, {
      perMessageDeflate: false,
      maxPayload: 64 * 1024 * 1024,
      ...(token ? { headers: { Authorization: "Bearer " + token } } : {}),
    });
    this.socket = socket;
    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      const pending = this.pending.get(message.id);
      if (pending && !message.method) {
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            Object.assign(Error(message.error.message), {
              rpcError: message.error,
              delivery: "rejected",
            }),
          );
        else pending.resolve(message.result);
      } else this.emit("message", message);
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.ready = null;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(
          Object.assign(Error("Shared Codex connection closed"), {
            delivery: "unknown",
          }),
        );
      }
      this.pending.clear();
      this.emit("disconnect");
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate();
        reject(
          Object.assign(Error("Shared Codex connection unavailable"), {
            delivery: "not-sent",
          }),
        );
      }, 5000);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (e) => {
        clearTimeout(timer);
        reject(Object.assign(e, { delivery: "not-sent" }));
      });
    });
    try {
      await this.request("initialize", {
        clientInfo: { name: "agent_pocket", version: "0.2.0" },
        capabilities: { experimentalApi: true },
      });
    } catch (error) {
      socket.terminate();
      throw error;
    }
    socket.send(JSON.stringify({ method: "initialized" }));
  }
  request(method, params = {}) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN)
        return reject(
          Object.assign(Error("Shared Codex is disconnected"), {
            delivery: "not-sent",
          }),
        );
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Object.assign(
            Error("Shared Codex request outcome unknown: " + method),
            { delivery: "unknown" },
          ),
        );
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async call(method, params) {
    await this.connect();
    return this.request(method, params);
  }
  respond(id, result, error) {
    this.socket?.send(
      JSON.stringify({ id, ...(error ? { error } : { result }) }),
    );
  }
  close() {
    this.socket?.close();
  }
}
