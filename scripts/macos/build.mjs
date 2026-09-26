import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin")
  throw Error("macOS packaging requires a Mac");
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = path.resolve(root, "artifacts/macos");
const bundle = path.join(out, "Pokite.app");
const contents = path.join(bundle, "Contents"),
  resources = path.join(contents, "Resources"),
  app = path.join(resources, "app");
const identity = process.env.POKITE_SIGN_IDENTITY || "-";
const release = process.argv.includes("--release");
if (release && !identity.startsWith("Developer ID Application:"))
  throw Error(
    "Public release requires an explicit Developer ID Application identity",
  );
const run = (bin, args, options = {}) =>
  execFileSync(bin, args, {
    cwd: root,
    stdio: "inherit",
    timeout: 300000,
    ...options,
  });
await fs.mkdir(out, { recursive: true });
await fs.rm(bundle, { recursive: true, force: true });
await fs.mkdir(path.join(contents, "MacOS"), { recursive: true });
await fs.mkdir(app, { recursive: true });
run("npm", ["run", "build"]);
for (const name of [
  "server",
  "shared",
  "dist",
  "integrations",
  "package.json",
  "package-lock.json",
  "LICENSE",
])
  await fs.cp(path.join(root, name), path.join(app, name), { recursive: true });
await fs.mkdir(path.join(app, "scripts"), { recursive: true });
for (const name of [
  "setup-codex-sharing.mjs",
  "setup-hermes-sharing.mjs",
  "codex-desktop-proxy.mjs",
  "uninstall.mjs",
])
  await fs.copyFile(
    path.join(root, "scripts", name),
    path.join(app, "scripts", name),
  );
// Dev-only proof scripts, private state and Git history never enter the bundle.
run("npm", ["ci", "--omit=dev", "--ignore-scripts"], { cwd: app });
const runtime = path.join(resources, "runtime");
await fs.mkdir(runtime, { recursive: true });
const node = await fs.realpath(
  process.env.POKITE_NODE_BINARY || process.execPath,
);
const deps = execFileSync("/usr/bin/otool", ["-L", node], { encoding: "utf8" })
  .split("\n")
  .slice(1)
  .map((s) => s.trim().split(" ")[0])
  .filter(Boolean);
if (
  deps.some(
    (s) => !s.startsWith("/usr/lib/") && !s.startsWith("/System/Library/"),
  )
)
  throw Error(
    "Use a standalone Node distribution; runtime links to external libraries",
  );
await fs.copyFile(node, path.join(runtime, "node"));
await fs.chmod(path.join(runtime, "node"), 0o755);
const nodeLicense =
  process.env.POKITE_NODE_LICENSE ||
  path.resolve(path.dirname(node), "../LICENSE");
await fs.copyFile(nodeLicense, path.join(runtime, "LICENSE"));
run("/usr/bin/xcrun", [
  "swiftc",
  "-O",
  "-target",
  `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos13.0`,
  "-framework",
  "AppKit",
  path.join(root, "native/macos/Pokite.swift"),
  "-o",
  path.join(contents, "MacOS/Pokite"),
]);
const info = {
  CFBundleName: "Pokite",
  CFBundleDisplayName: "Pokite",
  CFBundleIdentifier: "app.pokite.desktop",
  CFBundleExecutable: "Pokite",
  CFBundlePackageType: "APPL",
  CFBundleShortVersionString: "0.2.0",
  CFBundleVersion: "2",
  LSUIElement: true,
  LSMinimumSystemVersion: "13.0",
  CFBundleIconFile: "Pokite.icns",
  NSHighResolutionCapable: true,
};
const xml = execFileSync(
  "/usr/bin/plutil",
  ["-convert", "xml1", "-o", "-", "-"],
  { input: JSON.stringify(info), encoding: "utf8" },
);
await fs.writeFile(path.join(contents, "Info.plist"), xml);
const iconset = path.join(out, "Pokite.iconset");
await fs.mkdir(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512])
  for (const scale of [1, 2])
    run(
      "/usr/bin/sips",
      [
        "-z",
        String(size * scale),
        String(size * scale),
        path.join(root, "public/brand/pokite-512.png"),
        "--out",
        path.join(
          iconset,
          `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
        ),
      ],
      { stdio: "ignore" },
    );
run("/usr/bin/iconutil", [
  "-c",
  "icns",
  iconset,
  "-o",
  path.join(resources, "Pokite.icns"),
]);
const sign = (file) =>
  run("/usr/bin/codesign", [
    "--force",
    "--sign",
    identity,
    ...(identity === "-" ? [] : ["--options", "runtime"]),
    release ? "--timestamp" : "--timestamp=none",
    file,
  ]);
async function signNative(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const f = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await signNative(f);
    else {
      const h = await fs.open(f, "r");
      const bytes = Buffer.alloc(4);
      await h.read(bytes, 0, 4, 0);
      await h.close();
      if (
        ["cffaedfe", "cefaedfe", "cafebabe", "bebafeca"].includes(
          bytes.toString("hex"),
        )
      )
        sign(f);
    }
  }
}
await signNative(path.join(app, "node_modules"));
run("/usr/bin/codesign", [
  "--force",
  "--sign",
  identity,
  "--options",
  "runtime",
  "--entitlements",
  path.join(root, "native/macos/node-entitlements.plist"),
  release ? "--timestamp" : "--timestamp=none",
  path.join(runtime, "node"),
]);
sign(bundle);
run("/usr/bin/codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  bundle,
]);
run(path.join(contents, "MacOS/Pokite"), ["--version"]);
run(path.join(runtime, "node"), ["--version"]);
const stage = await fs.mkdtemp(path.join(out, ".dmg-"));
try {
  await fs.cp(bundle, path.join(stage, "Pokite.app"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await fs.symlink("/Applications", path.join(stage, "Applications"));
  const dmg = path.join(
    out,
    `Pokite-0.2.0-${process.arch}${release ? "" : "-development"}.dmg`,
  );
  await fs.rm(dmg, { force: true });
  run("/usr/bin/hdiutil", [
    "create",
    "-volname",
    "Pokite",
    "-srcfolder",
    stage,
    "-ov",
    "-format",
    "UDZO",
    dmg,
  ]);
  if (release) sign(dmg);
  console.log(
    JSON.stringify(
      {
        bundle,
        dmg,
        signature:
          identity === "-"
            ? "ad-hoc"
            : release
              ? "Developer ID"
              : "development",
        notarized: false,
      },
      null,
      2,
    ),
  );
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
