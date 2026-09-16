export { macHttpsProxy } from "../../server/desktop-network.mjs";

export async function verifyDesktopNetwork(fetcher = fetch) {
  const response = await fetcher(
    "https://api.anthropic.com/api/oauth/profile",
    { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000) },
  );
  await response.body?.cancel();
  if (response.status !== 401)
    throw Error(
      `Unauthenticated network preflight returned HTTP ${response.status}, expected 401. Check the configured proxy before requesting keychain access.`,
    );
  return { networkReady: true };
}
