import { Codex } from "./codex.mjs";
import { Penguin } from "./penguin.mjs";
import { Dsh } from "./dsh.mjs";
import { Claude } from "./claude.mjs";
import { ClaudeDesktopRemote } from "./claude-desktop-remote.mjs";
import { loadInstances } from "./instances.mjs";

// Keep the existing import surface for callers while implementations stay isolated.
export { Codex, codexFold } from "./codex.mjs";
export { Penguin } from "./penguin.mjs";
export { textContent } from "./content.mjs";
export const agentNames = {
  codex: "Codex",
  codex2: "Codex 2",
  dsh: "DeepSeek Harness",
  penguin: "PenguinHarness",
  claude: "Claude Code",
  claudeDesktop: "Claude Desktop",
};
export function makeAdapters(instances = loadInstances()) {
  return Object.fromEntries(
    instances.map((instance) => {
      const { id, provider } = instance;
      const adapter =
        provider === "codex"
          ? new Codex(id, instance.home)
          : provider === "dsh"
            ? new Dsh(instance.url)
            : provider === "penguin"
              ? new Penguin(instance.home)
              : provider === "claudeDesktop"
                ? new ClaudeDesktopRemote(instance.home)
                : new Claude(undefined, {
                    root: instance.home,
                    ...(id !== "claude"
                      ? {
                          stateFile: new URL(
                            `../.local/claude-${id}.json`,
                            import.meta.url,
                          ),
                        }
                      : {}),
                  });
      adapter.id = id;
      adapter.provider = provider;
      adapter.name = instance.name;
      return [id, adapter];
    }),
  );
}
