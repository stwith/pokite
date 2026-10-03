import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import express from "express";
import { stateDirectory } from "./state-paths.mjs";
import {
  fileReferences,
  localFileReference,
} from "../shared/file-references.mjs";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_STORAGE_BYTES = 500 * 1024 * 1024;
const textExtensions = new Set(
  "txt md markdown json csv tsv log js jsx ts tsx mjs cjs py rb go rs java c h cpp hpp css scss html xml svg yaml yml toml ini sql sh swift kt diff patch env".split(
    " ",
  ),
);
const failure = (message, status = 400) =>
  Object.assign(Error(message), { status });

export function previewType(name, bytes) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const starts = (signature) =>
    bytes.subarray(0, signature.length).equals(Buffer.from(signature));
  if (ext === "png" && starts([137, 80, 78, 71, 13, 10, 26, 10]))
    return { kind: "image", mime: "image/png" };
  if (["jpg", "jpeg"].includes(ext) && starts([255, 216, 255]))
    return { kind: "image", mime: "image/jpeg" };
  if (ext === "gif" && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()))
    return { kind: "image", mime: "image/gif" };
  if (
    ext === "webp" &&
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return { kind: "image", mime: "image/webp" };
  if (ext === "pdf" && starts([37, 80, 68, 70, 45]))
    return { kind: "pdf", mime: "application/pdf" };
  if (
    (textExtensions.has(ext) ||
      /^(README|LICENSE|Dockerfile|Makefile)$/i.test(path.basename(name))) &&
    !bytes.includes(0)
  )
    return {
      kind: ext === "md" || ext === "markdown" ? "markdown" : "text",
      mime: "text/plain",
    };
  return { kind: "unsupported", mime: "application/octet-stream" };
}

export function installChatFileRoutes(
  app,
  post,
  { root = path.join(stateDirectory(), "uploads"), project },
) {
  let uploadLock = Promise.resolve();
  async function scope(req) {
    if (typeof req.query.sessionId === "string" && req.query.sessionId) {
      const session = await req.adapter.detail(req.query.sessionId);
      if (session.readOnly && req.method === "POST")
        throw failure(session.readOnlyReason || "此会话只读", 409);
      return {
        session,
        project: await project(req.adapter, session.projectId),
      };
    }
    if (typeof req.query.projectId !== "string") throw failure("请选择项目");
    return { project: await project(req.adapter, req.query.projectId) };
  }
  app.post(
    "/api/:agent/files/upload",
    express.raw({ type: "application/octet-stream", limit: MAX_UPLOAD_BYTES }),
  );
  post("/api/:agent/files/upload", async (req, res) => {
    const context = await scope(req);
    if (
      !context.project.path ||
      !path.isAbsolute(context.project.path) ||
      !(await fs.stat(context.project.path).catch(() => null))?.isDirectory()
    )
      throw failure("此会话没有本地文件目录", 409);
    if (
      req.adapter.readOnly ||
      req.adapter.capabilities?.reply === false ||
      (!context.session && context.project.canCreate === false)
    )
      throw failure("此会话不支持上传", 409);
    const supplied = req.query.name;
    if (
      typeof supplied !== "string" ||
      !supplied.trim() ||
      supplied.length > 240 ||
      /[\x00-\x1f]/.test(supplied)
    )
      throw failure("文件名无效");
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      throw failure("文件为空或格式无效");
    const bytes = req.body;
    if (bytes.length > MAX_UPLOAD_BYTES)
      throw failure("单个文件不能超过 20 MB", 413);
    const name = path
      .basename(supplied.replaceAll("\\", "/"))
      .replace(/[<>:"|?*]/g, "_");
    if (!name || name === "." || name === ".." || name === "receipt.json")
      throw failure("文件名无效");
    const previous = uploadLock;
    let release;
    uploadLock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    let directory;
    try {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      let used = 0;
      const entries = await fs.readdir(root);
      for (const id of entries) {
        const receipt = await fs
          .readFile(path.join(root, id, "receipt.json"), "utf8")
          .then(JSON.parse)
          .catch(() => null);
        used += receipt?.size || 0;
      }
      if (entries.length >= 200 || used + bytes.length > MAX_STORAGE_BYTES)
        throw failure("附件存储空间已满", 413);
      directory = path.join(root, randomUUID());
      await fs.mkdir(directory, { mode: 0o700 });
      const file = path.join(directory, name);
      await fs.writeFile(file, bytes, { mode: 0o600, flag: "wx" });
      const receipt = {
        agent: req.params.agent,
        projectId: context.project.id,
        sessionId: context.session?.id || null,
        path: file,
        name,
        size: bytes.length,
      };
      await fs.writeFile(
        path.join(directory, "receipt.json"),
        JSON.stringify(receipt),
        { mode: 0o600, flag: "wx" },
      );
      res.json({
        name,
        path: file,
        size: bytes.length,
        ...previewType(name, bytes),
      });
    } catch (error) {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
      throw error;
    } finally {
      release();
    }
  });

  app.get("/api/:agent/files/preview", async (req, res) => {
    const target = localFileReference(req.query.path);
    if (!target) throw failure("文件路径无效");
    const context = await scope(req);
    const base = context.session?.cwd || context.project.path;
    if (!base || !path.isAbsolute(base))
      throw failure("此会话没有本地文件目录", 409);
    const candidate = path.resolve(base, target);
    let allowed = false;
    const relative = path.relative(root, candidate);
    if (
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      relative.split(path.sep).length === 2
    ) {
      const receipt = await fs
        .readFile(
          path.join(root, relative.split(path.sep)[0], "receipt.json"),
          "utf8",
        )
        .then(JSON.parse)
        .catch(() => null);
      allowed =
        receipt?.path === candidate &&
        receipt.agent === req.params.agent &&
        receipt.projectId === context.project.id &&
        (!receipt.sessionId || receipt.sessionId === context.session?.id);
    }
    if (
      !allowed &&
      (candidate === root || candidate.startsWith(root + path.sep))
    )
      throw failure("只能预览此聊天中引用的文件", 403);
    if (!allowed && context.session) {
      let messages = context.session.messages || [];
      if (req.query.before !== undefined) {
        if (
          typeof req.query.before !== "string" ||
          req.query.before.length > 200 ||
          !req.adapter.history
        )
          throw failure("Invalid cursor");
        const history = await req.adapter.history(
          context.session.id,
          req.query.before,
        );
        messages = [...messages, ...(history.messages || [])];
      }
      allowed = messages.some((m) =>
        fileReferences(m.text).some(
          (ref) => path.resolve(base, ref) === candidate,
        ),
      );
    }
    if (!allowed) throw failure("只能预览此聊天中引用的文件", 403);
    const protectedPath = (value) =>
      value
        .split(path.sep)
        .some((p) => /^\.(?:ssh|aws|codex(?:-\d+)?|dsh)$/.test(p)) ||
      /^(?:\.env(?:\..*)?|access-token|auth\.json|credentials(?:\..*)?)$/i.test(
        path.basename(value),
      ) ||
      /\.(pem|key)$/i.test(value) ||
      (value.startsWith(stateDirectory() + path.sep) &&
        !value.startsWith(root + path.sep));
    if (protectedPath(candidate)) throw failure("此文件不可预览", 403);
    let handle;
    try {
      // Refuse symlinks and read a single pinned regular-file descriptor.
      if (!(await fs.lstat(candidate)).isFile())
        throw failure("此文件不可预览", 403);
      const parent = await fs.realpath(path.dirname(candidate));
      if (protectedPath(path.join(parent, path.basename(candidate))))
        throw failure("此文件不可预览", 403);
      const realBase = await fs.realpath(base);
      const relativeParent = path.relative(base, path.dirname(candidate));
      if (
        !relativeParent.startsWith("..") &&
        parent !== path.resolve(realBase, relativeParent)
      )
        throw failure("此文件不可预览", 403);
      handle = await fs.open(
        path.join(parent, path.basename(candidate)),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const stat = await handle.stat();
      if (!stat.isFile()) throw failure("此文件不可预览", 403);
      if (stat.size > MAX_UPLOAD_BYTES)
        throw failure("预览文件不能超过 20 MB", 413);
      const header = Buffer.alloc(Math.min(512, stat.size));
      await handle.read(header, 0, header.length, 0);
      const type = previewType(candidate, header);
      const result = {
        name: path.basename(candidate),
        size: stat.size,
        ...type,
      };
      if (type.kind === "unsupported") return res.json(result);
      const text = ["text", "markdown"].includes(type.kind);
      const length = Math.min(stat.size, text ? 200000 : MAX_UPLOAD_BYTES);
      const bytes = Buffer.alloc(length);
      const { bytesRead } = await handle.read(bytes, 0, length, 0);
      if (text) {
        if (bytes.subarray(0, bytesRead).includes(0))
          return res.json({ ...result, kind: "unsupported" });
        result.text = bytes.subarray(0, bytesRead).toString("utf8");
        result.truncated = stat.size > length;
      } else result.base64 = bytes.subarray(0, bytesRead).toString("base64");
      res.json(result);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code))
        throw failure("文件已不存在", 404);
      if (["ELOOP", "EACCES"].includes(error.code))
        throw failure("此文件不可预览", 403);
      throw error;
    } finally {
      await handle?.close();
    }
  });
}
