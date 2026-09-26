import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { createApp } from "../server/app.mjs";
import { isLocalAdminRequest } from "../server/local-admin.mjs";
import { tailscaleCommand } from "../server/tailscale-command.mjs";
import { networkLinks } from "../server/network-links.mjs";
import { NetworkListeners } from "../server/network-listeners.mjs";
import { renderDesktopLauncher } from "../server/sharing-setup.mjs";
import { updateOwnedRuntime } from "../server/owned-runtime.mjs";
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pokite-followup-"));

test("Tailscale app executable is used when no PATH command exists", async () => {
  const seen = [];
  const result = await tailscaleCommand(
    ["status", "--json"],
    async (command, args) => {
      seen.push(command);
      assert.deepEqual(args, ["status", "--json"]);
      if (command === "tailscale")
        throw Object.assign(Error("not found"), { code: "ENOENT" });
      return { stdout: '{"BackendState":"Running"}' };
    },
  );
  assert.equal(seen[1], "/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  assert.match(result.stdout, /Running/);
});

test("network links only advertise confirmed reachable listeners", () => {
  const interfaces = {
    en0: [{ family: "IPv4", address: "192.168.1.6" }],
    utun: [{ family: "IPv4", address: "100.64.1.2" }],
  };
  assert.equal(
    networkLinks(3230, interfaces, null, ["127.0.0.1"], ["100.64.1.2"])
      .tailscale,
    null,
  );
  assert.equal(
    networkLinks(3230, interfaces, null, ["0.0.0.0"], []).tailscale,
    null,
  );
  assert.ok(
    networkLinks(
      3230,
      interfaces,
      null,
      ["127.0.0.1", "100.64.1.2"],
      ["100.64.1.2"],
    ).tailscale,
  );
});

test("tailnet listeners reconcile connect, address changes, failure and disconnect", async () => {
  let ips = [],
    fail = false;
  const made = [];
  const manager = new NetworkListeners({
    port: 12345,
    allowLan: false,
    handler() {},
    detect: async () => ips,
    addresses: (_, __, ips) => ["127.0.0.1", ...ips],
    create: () => {
      const s = new EventEmitter();
      s.listen = (_, ip, done) =>
        queueMicrotask(() =>
          fail
            ? s.emit(
                "error",
                Object.assign(Error("bind"), { code: "EADDRNOTAVAIL" }),
              )
            : done(),
        );
      s.close = () => {
        s.closed = true;
      };
      s.closeAllConnections = () => {
        s.destroyed = true;
      };
      made.push(s);
      return s;
    },
  });
  await manager.refresh();
  assert.deepEqual(manager.listening(), ["127.0.0.1"]);
  ips = ["100.64.1.2"];
  await manager.refresh();
  assert.ok(manager.listening().includes(ips[0]));
  ips = ["100.64.1.3"];
  await manager.refresh();
  assert.equal(made[0].destroyed, true);
  fail = true;
  ips = ["100.64.1.4"];
  await manager.refresh();
  assert.deepEqual(manager.listening(), ["127.0.0.1"]);
  fail = false;
  await manager.refresh();
  assert.ok(manager.listening().includes(ips[0]));
  ips = [];
  await manager.refresh();
  assert.deepEqual(manager.listening(), ["127.0.0.1"]);
  manager.close();
});

test("launcher preflight catches syntax and imported dependency failures before Desktop launch", () => {
  const dir = temp();
  try {
    const proxy = path.join(dir, "scripts/proxy.mjs"),
      fallback = path.join(dir, "native"),
      launcher = path.join(dir, "launcher");
    fs.mkdirSync(path.dirname(proxy), { recursive: true });
    fs.mkdirSync(path.join(dir, "node_modules/ws"), { recursive: true });
    fs.writeFileSync(fallback, '#!/bin/sh\nprintf "native:%s" "$1"\n', {
      mode: 0o700,
    });
    fs.writeFileSync(
      launcher,
      renderDesktopLauncher(
        process.execPath,
        proxy,
        path.join(dir, "config"),
        fallback,
      ),
      { mode: 0o700 },
    );
    for (const source of [
      "invalid javascript {{{",
      'import "missing-dependency";',
    ]) {
      fs.writeFileSync(proxy, source);
      assert.equal(
        execFileSync(launcher, ["original arg"], { encoding: "utf8" }),
        "native:original arg",
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("owned runtime refreshes same-version changed bytes and preserves old runtime on failure", async () => {
  const dir = temp();
  try {
    const source = path.join(dir, "source"),
      dest = path.join(dir, "runtime/node");
    const script = (comment) =>
      "#!/bin/sh\n# " +
      comment +
      '\nif [ "$1" = "--version" ]; then echo v22.23.2; fi\n';
    fs.writeFileSync(source, script("a"), { mode: 0o700 });
    assert.equal(await updateOwnedRuntime(source, dest, "fixture"), true);
    assert.equal(await updateOwnedRuntime(source, dest, "fixture"), false);
    fs.writeFileSync(source, script("b"));
    assert.equal(await updateOwnedRuntime(source, dest, "fixture"), true);
    const before = fs.readFileSync(dest, "utf8");
    fs.writeFileSync(source, "#!/bin/sh\nexit 1\n");
    await assert.rejects(updateOwnedRuntime(source, dest, "fixture"));
    assert.equal(fs.readFileSync(dest, "utf8"), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("agent discovery runs outside the request event loop and shares concurrent scans", async () => {
  const { discoverMachineAsync } = await import(
    "../server/discovery-async.mjs"
  );
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    const first = discoverMachineAsync(),
      second = discoverMachineAsync();
    assert.equal(first, second);
    const report = await first;
    assert.ok(Array.isArray(report.instances));
    assert.ok(ticks > 0);
  } finally {
    clearInterval(timer);
  }
});
