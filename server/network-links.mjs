import os from "node:os";
export function networkLinks(
  port,
  interfaces = os.networkInterfaces(),
  preferred,
) {
  const addresses = Object.entries(interfaces).flatMap(([name, rows]) =>
    (rows || [])
      .filter((row) => row.family === "IPv4" && !row.internal)
      .map((row) => ({ name, address: row.address })),
  );
  const parts = (address) => address.split(".").map(Number);
  const tailscale = (address) => {
    const [a, b] = parts(address);
    return a === 100 && b >= 64 && b <= 127;
  };
  const privateLan = (address) => {
    const [a, b] = parts(address);
    return (
      a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
    );
  };
  const score = (row) =>
    row.address === preferred
      ? 0
      : /^(en\d|eth\d|wlan\d|Wi-Fi|Ethernet)/i.test(row.name)
        ? 1
        : 2;
  const choose = (predicate) =>
    addresses
      .filter((row) => predicate(row.address))
      .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))[0];
  const link = (row) =>
    row
      ? { url: `http://${row.address}:${port}/`, address: row.address }
      : null;
  return { lan: link(choose(privateLan)), tailscale: link(choose(tailscale)) };
}
