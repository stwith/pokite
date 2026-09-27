import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { desktopCodeCreationStatus } from "../server/desktop-code-creation.mjs";
test("creation diagnosis is version, organization and freshness scoped and never claims implemented support", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pokite-create-gate-"));
  const infoFile = path.join(root, "Info.plist");
  const options = { infoFile, organization: "org", now: 100000 };
  const write = async (on, orgUuid = "org", timestamp = 99999) =>
    fs.writeFile(
      path.join(root, "fcache"),
      Buffer.concat([
        Buffer.from([67, 76, 70, 2, 0, 154, 183, 226]),
        gzipSync(
          JSON.stringify({
            mode: "1p",
            orgUuid,
            timestamp,
            features: { 1183214304: { on } },
          }),
        ),
      ]),
    );
  try {
    await fs.writeFile(
      infoFile,
      "<key>CFBundleShortVersionString</key><string>2.9939.2</string>",
    );
    await write(false);
    assert.equal(
      (await desktopCodeCreationStatus(root, options)).state,
      "unavailable",
    );
    await write(false, "other");
    assert.equal(
      (await desktopCodeCreationStatus(root, options)).state,
      "unknown",
    );
    await write(true);
    assert.equal(
      (await desktopCodeCreationStatus(root, options)).state,
      "detected",
    );
    assert.equal(
      (await desktopCodeCreationStatus(root, { ...options, now: 90000000 }))
        .state,
      "unknown",
    );
    await fs.writeFile(
      infoFile,
      "<key>CFBundleShortVersionString</key><string>3.0.0</string>",
    );
    assert.equal(
      (await desktopCodeCreationStatus(root, options)).state,
      "unknown",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
