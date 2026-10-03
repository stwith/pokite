import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app.mjs";
import { Operations } from "../server/operations.mjs";
import { MessageQueue } from "../server/message-queue.mjs";
import {
  fileReferences,
  attachmentMarkdown,
  localFileReference,
} from "../shared/file-references.mjs";
import { previewType, MAX_UPLOAD_BYTES } from "../server/chat-files.mjs";

let dir, base, server, app, adapters, uploadRoot, detailMessages;
const headers = { Authorization: "Bearer test-code" };
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-files-"));
  uploadRoot = path.join(dir, "uploads");
  const adapter = () => ({
    projects: async () => [{ id: "p", path: dir }],
    detail: async (id) => ({
      id,
      projectId: "p",
      cwd: dir,
      messages: detailMessages || [],
    }),
    history: async (_id, before) => ({
      messages: before === "older" ? [{ text: "[old](old.txt)" }] : [],
    }),
  });
  adapters = { codex: adapter(), codex2: adapter() };
  app = createApp({
    adapters,
    agentNames: { codex: "Codex", codex2: "Codex2" },
    token: "test-code",
    operations: new Operations(path.join(dir, "ops.json")),
    messages: new MessageQueue(path.join(dir, "queue.json"), adapters),
    reads: {},
    saveReads() {},
    dist: path.join(dir, "dist"),
    uploadDirectory: uploadRoot,
    getPort: () => server.address().port,
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  app.locals.events.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});
const upload = (
  name,
  bytes,
  query = "sessionId=s",
  agent = "codex",
  auth = headers,
) =>
  fetch(
    `${base}/api/${agent}/files/upload?name=${encodeURIComponent(name)}&${query}`,
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/octet-stream" },
      body: bytes,
    },
  );
const preview = (file, extra = {}, agent = "codex") =>
  fetch(
    `${base}/api/${agent}/files/preview?${new URLSearchParams({ path: file, sessionId: "s", ...extra })}`,
    { headers },
  );

test("Markdown references are parsed structurally, not remote URLs or code blocks", () => {
  assert.deepEqual(
    fileReferences(
      "[one](</tmp/space%20file.txt:12>)\n![photo](file:///tmp/a.png)\n`/tmp/code.ts:2`\n[remote](https://example.com/a.png)\n```\n[no](/tmp/no.txt)\n```",
    ),
    ["/tmp/space file.txt", "/tmp/a.png", "/tmp/code.ts"],
  );
  assert.equal(localFileReference("javascript:alert(1).txt"), null);
  assert.equal(localFileReference("file://evil.test/tmp/a.txt"), null);
  assert.equal(localFileReference("/tmp/%00a.txt"), null);
  const file = { name: "a [测试].txt", path: "/tmp/测试 file (1).txt" };
  assert.deepEqual(fileReferences(attachmentMarkdown(file)), [file.path]);
  assert.deepEqual(fileReferences("[file][a]\n\n[a]: /tmp/a.txt"), [
    "/tmp/a.txt",
  ]);
});

test("upload is authenticated, traversal-safe, durable, and isolated by profile/session", async () => {
  assert.equal(
    (await upload("a.txt", "hello", "sessionId=s", "codex", {})).status,
    401,
  );
  const response = await upload("../../测试.txt", "hello from phone");
  assert.equal(response.status, 200);
  const file = await response.json();
  assert.equal(file.name, "测试.txt");
  assert.ok(file.path.startsWith(uploadRoot + path.sep));
  assert.equal(await fs.readFile(file.path, "utf8"), "hello from phone");
  assert.equal((await fs.stat(file.path)).mode & 0o777, 0o600);
  assert.equal((await preview(file.path)).status, 200);
  assert.equal(
    (await (await preview(file.path)).json()).text,
    "hello from phone",
  );
  detailMessages = [{ text: attachmentMarkdown(file) }];
  assert.equal((await preview(file.path, {}, "codex2")).status, 403);
  assert.equal((await preview(file.path, { sessionId: "other" })).status, 403);
  detailMessages = [];
  assert.equal((await upload("empty.txt", "")).status, 400);
  assert.equal(
    (await upload("a.txt", "hello", "projectId=unknown")).status,
    404,
  );
  assert.equal(
    (await upload("a.txt", Buffer.alloc(MAX_UPLOAD_BYTES + 1))).status,
    413,
  );
});

test("draft uploads can be previewed after creation and rejects read-only uploads", async () => {
  const file = await (await upload("draft.txt", "draft", "projectId=p")).json();
  assert.equal((await preview(file.path)).status, 200);
  const prior = adapters.codex.detail;
  adapters.codex.detail = async (id) => ({
    ...(await prior(id)),
    readOnly: true,
  });
  try {
    assert.equal((await upload("a.txt", "x")).status, 409);
  } finally {
    adapters.codex.detail = prior;
  }
});

test("desktop previews require references and reject symlinks, secrets, directories, and missing files", async () => {
  await fs.writeFile(path.join(dir, "report.txt"), "desktop report");
  await fs.writeFile(path.join(dir, "old.txt"), "old report");
  await fs.writeFile(path.join(dir, ".env.txt"), "secret");
  await fs.symlink(path.join(dir, "report.txt"), path.join(dir, "link.txt"));
  detailMessages = [];
  assert.equal((await preview("report.txt")).status, 403);
  detailMessages = [
    {
      text: "[report](report.txt)\n[missing](missing.txt)\n[link](link.txt)\n[secret](.env.txt)",
    },
  ];
  const result = await (await preview("report.txt")).json();
  assert.equal(result.text, "desktop report");
  assert.equal((await preview("link.txt")).status, 403);
  assert.equal((await preview(".env.txt")).status, 403);
  assert.equal((await preview("missing.txt")).status, 404);
  assert.equal((await preview("old.txt")).status, 403);
  assert.equal((await preview("old.txt", { before: "older" })).status, 200);
  await fs.mkdir(path.join(dir, "folder.txt"));
  detailMessages = [{ text: "[folder](folder.txt)" }];
  assert.equal((await preview("folder.txt")).status, 403);
});

test("image/PDF signatures and safe text previews do not trust filename MIME", async () => {
  assert.equal(
    previewType("fake.png", Buffer.from("<script>bad</script>")).kind,
    "unsupported",
  );
  assert.equal(
    previewType("page.html", Buffer.from("<script>bad</script>")).kind,
    "text",
  );
  assert.equal(
    previewType("vector.svg", Buffer.from("<svg onload='bad'/>")).kind,
    "text",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2sAAAAASUVORK5CYII=",
    "base64",
  );
  const image = await (await upload("photo.png", png)).json();
  const response = await preview(image.path);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const value = await response.json();
  assert.equal(value.kind, "image");
  assert.deepEqual(Buffer.from(value.base64, "base64"), png);
  const pdf = await (await upload("a.pdf", "%PDF-1.7\nfixture")).json();
  assert.equal((await (await preview(pdf.path)).json()).kind, "pdf");
  const hugeText = await (await upload("huge.log", "a".repeat(220000))).json();
  const text = await (await preview(hugeText.path)).json();
  assert.equal(text.truncated, true);
  assert.equal(text.text.length, 200000);
  const executable = await (
    await upload("program.bin", Buffer.from([0, 1, 2]))
  ).json();
  assert.equal(
    (await (await preview(executable.path)).json()).kind,
    "unsupported",
  );
});
