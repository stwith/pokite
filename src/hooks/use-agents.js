import { useEffect, useState } from "react";
import { api } from "../lib/api";

const agentOrder = [
  "codex",
  "codex2",
  "claudeDesktop",
  "claudeDesktopCode",
  "claude",
  "dsh",
  "hermesDesktop",
  "penguin",
];
const compareAgents = (a, b) => {
  const rank = (id) =>
    agentOrder.includes(id) ? agentOrder.indexOf(id) : agentOrder.length;
  return rank(a.id) - rank(b.id);
};

export const fetchAgents = async () =>
  (await api("/agents")).sort(compareAgents);

// The agent list and the selected agent. While signed in the list refreshes
// every minute, on focus and on "pokite:agents-changed"; a vanished
// selection falls back to the first agent.
export function useAgents({ authed, initialAgent, onEmpty }) {
  const [agents, setAgents] = useState([]),
    [agent, setAgent] = useState(initialAgent);
  function applyAgents(available) {
    setAgents(available);
    setAgent((current) =>
      available.some((item) => item.id === current)
        ? current
        : available[0]?.id || "",
    );
  }
  useEffect(() => {
    if (!authed) return;
    const refresh = async () => {
      try {
        const available = await fetchAgents();
        applyAgents(available);
        if (!available.length) onEmpty();
      } catch {
        /* Existing sync indicators handle connection loss. */
      }
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    window.addEventListener("pokite:agents-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pokite:agents-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [authed]);
  return { agents, setAgents, agent, setAgent, applyAgents };
}
