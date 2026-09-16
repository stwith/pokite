export function macHttpsProxy(output) {
  const fields = new Map(
    [
      ...output.matchAll(/^\s*(HTTPS(?:Enable|Proxy|Port))\s*:\s*(\S+)\s*$/gm),
    ].map((m) => [m[1], m[2]]),
  );
  if (fields.get("HTTPSEnable") !== "1") return null;
  const host = fields.get("HTTPSProxy"),
    port = Number(fields.get("HTTPSPort"));
  if (
    !host ||
    !/^[a-zA-Z0-9.:[\]-]+$/.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw Error("Unsupported macOS HTTPS proxy configuration");
  return `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
}
