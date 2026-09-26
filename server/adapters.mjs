import { stateFile } from "./state-paths.mjs";
import { Codex } from "./codex.mjs";
import { Penguin } from "./penguin.mjs";
import { Dsh } from "./dsh.mjs";
import { ClaudeDesktopRemote } from "./claude-desktop-remote.mjs";
import { Claude } from "./claude.mjs";
import { HermesDesktop } from "./hermes-desktop.mjs";
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
  claude: "Claude Code CLI",
  claudeDesktop: "Claude Desktop",
  hermesDesktop: "Hermes Desktop",
};
const factories = {
  claudeDesktop: ({ home }) => new ClaudeDesktopRemote(home),
  codex: ({ id, home }) => new Codex(id, home),
  dsh: ({ url }) => new Dsh(url),
  penguin: ({ home }) => new Penguin(home),
  hermesDesktop: ({ home }) => new HermesDesktop(home),
  claude: ({ id, home }) =>
    new Claude(undefined, {
      root: home,
      ...(id !== "claude" ? { stateFile: stateFile(`claude-${id}.json`) } : {}),
    }),
};
export function makeAdapters(instances = loadInstances()) {
  return Object.fromEntries(
    instances.map((instance) => {
      const factory = factories[instance.provider];
      if (!Object.hasOwn(factories, instance.provider))
        throw Error("Unsupported provider: " + instance.provider);
      const adapter = factory(instance);
      Object.assign(adapter, {
        id: instance.id,
        provider: instance.provider,
        name: instance.name,
        pokiteEnabled: instance.enabled !== false,
      });
      return [instance.id, adapter];
    }),
  );
}
