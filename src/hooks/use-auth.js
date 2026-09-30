import { useEffect, useState } from "react";
import {
  captureAccessToken,
  getAccessToken,
  persistAccessToken,
  setAccessToken,
  takeInitialAccessToken,
} from "../lib/api";
import { t } from "../lib/i18n.js";
import { fetchAgents } from "./use-agents";

// Access-code sign-in. Signs in on load with a saved or linked code, again
// when another access link reuses this tab, and signs out when the server
// reports the code expired (onExpired clears the session state).
export function useAuth({ applyAgents, setError, onExpired }) {
  const [token, setToken] = useState(getAccessToken),
    [authed, setAuthed] = useState(false);
  useEffect(() => {
    const expired = () => {
      setAuthed(false);
      setToken("");
      onExpired();
      setError(t("访问码已失效，请重新连接"));
    };
    window.addEventListener("pokite:auth-expired", expired);
    return () => window.removeEventListener("pokite:auth-expired", expired);
  }, []);
  async function login(credential = token, retryInitial = true) {
    setAccessToken(credential.trim());
    try {
      applyAgents(await fetchAgents());
      if (getAccessToken() !== credential.trim()) return;
      persistAccessToken();
      takeInitialAccessToken();
      setAuthed(true);
      setError("");
    } catch (e) {
      const ticket =
        retryInitial && [401, 403].includes(e.status)
          ? takeInitialAccessToken()
          : null;
      if (ticket && ticket !== credential.trim()) return login(ticket, false);
      setError(e.message);
    }
  }
  useEffect(() => {
    if (getAccessToken()) login();
    // Opening another access link may reuse this tab as a same-document navigation.
    const pairedLink = () => {
      if (captureAccessToken()) void login(getAccessToken());
    };
    window.addEventListener("hashchange", pairedLink);
    return () => window.removeEventListener("hashchange", pairedLink);
  }, []);
  return { token, setToken, authed, login };
}
