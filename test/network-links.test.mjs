import test from "node:test";
import assert from "node:assert/strict";
import { networkLinks } from "../server/network-links.mjs";
test("LAN and tailnet are separated and current LAN interface wins", () => {
  const row = (address) => ({ address, family: "IPv4", internal: false });
  const interfaces = {
    en0: [row("192.168.1.6")],
    en1: [row("10.0.0.5")],
    utun0: [row("100.108.1.2")],
    bridge: [row("172.17.0.1")],
    public: [row("8.8.8.8")],
  };
  const links = networkLinks(3230, interfaces, "10.0.0.5");
  assert.equal(links.lan.url, "http://10.0.0.5:3230/");
  assert.equal(links.tailscale.url, "http://100.108.1.2:3230/");
  assert.deepEqual(networkLinks(3230, {}), { lan: null, tailscale: null });
});
