import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// dsh 0.2 transport: RPCs are POST /api/<ns>/<method> with the arguments
// wrapped in payload.args, and every Remote stream is multiplexed over one
// /api/remote.mux WebSocket ({type:"open"|"cancel"} in, item/end/error out).
export class DshRemote {
  constructor(base, { fetchAuthorized, headers }) {
    this.base = base;
    this.fetchAuthorized = fetchAuthorized;
    this.headers = headers;
    this.streams = new Map();
  }
  async call(method, args = {}) {
    const rpcId = randomUUID();
    const response = await this.fetchAuthorized("/api/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        method,
        payload: { args },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Object.assign(Error("DeepSeek Harness HTTP " + response.status), {
        httpStatus: response.status,
      });
    const body = await response.json();
    if (!body.result?.ok)
      throw Object.assign(
        Error(body.result?.error?.message || JSON.stringify(body.result)),
        { code: body.result?.error?.code },
      );
    return body.result.value;
  }
  socket() {
    if (this.mux && this.mux.readyState <= WebSocket.OPEN) return this.mux;
    const socket = new WebSocket(
      this.base.replace(/^http/, "ws") + "/api/remote.mux",
      { origin: this.base, headers: this.headers() },
    );
    this.mux = socket;
    const endAll = (error) => {
      for (const [id, stream] of this.streams)
        if (stream.socket === socket) {
          this.streams.delete(id);
          stream.end(error);
        }
    };
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      const stream = this.streams.get(message.streamId);
      if (!stream) return;
      if (message.type === "item") return stream.item(message.value);
      this.streams.delete(message.streamId);
      stream.end(
        message.type === "error"
          ? Error(message.error?.message || "DeepSeek Harness 数据流出错")
          : null,
      );
    });
    socket.on("unexpected-response", (request, response) => {
      socket.terminate();
      endAll(
        Object.assign(Error("DeepSeek Harness HTTP " + response.statusCode), {
          httpStatus: response.statusCode,
        }),
      );
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.mux === socket) this.mux = null;
      endAll(Error("DeepSeek Harness 连接已断开"));
    });
    return socket;
  }
  // Open a Remote stream; returns a function that cancels it.
  stream(endpoint, args, { item, end = () => {} }) {
    const socket = this.socket();
    const streamId = randomUUID();
    this.streams.set(streamId, { socket, item, end });
    const open = () =>
      socket.send(
        JSON.stringify({ type: "open", streamId, endpoint, payload: { args } }),
      );
    if (socket.readyState === WebSocket.OPEN) open();
    else socket.once("open", open);
    return () => {
      if (!this.streams.delete(streamId)) return;
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "cancel", streamId }));
    };
  }
  // First frame of a stream (a snapshot or baseline), then cancel it.
  first(endpoint, args, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cancel();
        reject(Error("DeepSeek Harness 响应超时：" + endpoint));
      }, timeoutMs);
      const cancel = this.stream(endpoint, args, {
        item: (value) => {
          clearTimeout(timer);
          cancel();
          resolve(value);
        },
        end: (error) => {
          clearTimeout(timer);
          reject(
            error || Error("DeepSeek Harness 数据流提前结束：" + endpoint),
          );
        },
      });
    });
  }
  close() {
    this.mux?.terminate();
  }
}
