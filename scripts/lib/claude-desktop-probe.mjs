import { canonicalDesktopSessionId } from "../../server/claude-desktop-credentials.mjs";
export {
  decryptDesktopCache,
  sessionCredential,
  canonicalDesktopSessionId,
} from "../../server/claude-desktop-credentials.mjs";

export async function readSessionProbe(
  token,
  account,
  organization,
  fetcher = fetch,
  expectedSessionIds = [],
) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "ccr-byoc-2025-07-29",
    "anthropic-client-feature": "ccr",
    "x-organization-uuid": organization,
  };
  async function get(route) {
    const response = await fetcher("https://api.anthropic.com" + route, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const body = await response.text();
      const hints = [];
      for (const [name, pattern] of [
        ["untrusted_device", /untrusted_device/i],
        ["scope", /scope/i],
        ["expired", /expired/i],
        ["account_mismatch", /account_mismatch/i],
        ["region", /region|country|location/i],
        ["challenge", /cloudflare|challenge-platform|just a moment/i],
      ])
        if (pattern.test(body)) hints.push(name);
      throw Error(
        `Desktop read-only probe ${route.split("?")[0]} HTTP ${response.status}; type=${response.headers.get("content-type")?.split(";")[0] || "unknown"}; hints=${hints.join(",") || "none"}`,
      );
    }
    return response.json();
  }
  const profile = await get("/api/oauth/profile");
  if (
    profile.account?.uuid !== account ||
    profile.organization?.uuid !== organization
  )
    throw Error("Desktop profile identity could not be verified");
  const body = await get(
    "/v1/code/sessions?limit=20&include_trigger_sessions=true",
  );
  const sessions = body.sessions || body.data;
  if (!Array.isArray(sessions))
    throw Error("Unrecognized Desktop session-list response");
  const knownSessions = [];
  for (const id of [...new Set(expectedSessionIds)].slice(0, 4)) {
    const canonicalId = canonicalDesktopSessionId(id);
    if (!canonicalId) continue;
    try {
      const data = await get(
        "/v1/code/sessions/" + encodeURIComponent(canonicalId),
      );
      const session = data.session || data.response_shape;
      knownSessions.push({
        found: canonicalDesktopSessionId(session?.id) === canonicalId,
        titleAvailable: typeof session?.title === "string",
        fields: Object.keys(session || {}),
      });
    } catch (error) {
      knownSessions.push({
        found: false,
        error: error.message.replace(canonicalId, "[known-session]"),
      });
    }
  }
  return {
    verifiedAccount: true,
    sessionCount: sessions.length,
    responseKeys: Object.keys(body),
    knownSessions,
  };
}
