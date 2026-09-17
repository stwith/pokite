# Pokite

<img src="public/brand/pokite-mark.svg" width="88" height="88" alt="Pokite logo" />

English | [简体中文](README.zh-CN.md)

**Your computer's running coding agents. The same sessions, on your phone.**

Pokite gives your computer's agent sessions a mobile entry point. Continue using
multiple supported agents in one web interface: check progress, read results and
send follow-ups. No mobile app required. Connect over LAN or Tailscale, with
Pokite self-hosted on your computer.

Pokite is a self-hosted mobile web interface for supported desktop AI coding agents:
**Codex Desktop, Hermes Desktop, DeepSeek Harness, PenguinHarness, Claude Code CLI,
and Claude Desktop Cowork**, with different capabilities for each integration.
Keep working in your desktop client; open Pokite in iPhone Safari, an Android
browser, or on an iPad to read progress and send follow-up instructions.

Your projects, execution environment and model credentials stay on the computer.
Connect over your home LAN or Tailscale. Pokite runs on that computer and does not
operate a hosted relay. Cowork uses Anthropic's remote session API; model calls
still use each agent's configured provider. See the support table before setup.

> macOS developer preview. There is no signed installer yet. Windows, Linux and multiple Desktop versions have not passed compatibility acceptance.

## Six core features

### Keep your work moving

- **Continue the original session away from your desk.** Read progress and send follow-ups from your phone, then continue in Desktop. Same-session sharing depends on the integration below.
- **Multiple agents, one mobile entry point.** Switch between supported agents and multiple instances to access their projects and conversations.
- **Keep your existing workflow.** Use your familiar Desktop clients, projects and execution environments.

### Connect on your terms

- **No mobile app required.** Open a browser on your phone or tablet. No Pokite account needed.
- **LAN or Tailscale.** Connect over your local network at home, or your own Tailscale network when away.
- **Self-hosted on your computer.** You run Pokite alongside your agents; no Pokite-hosted relay is required.

Agent model calls still use their configured providers. Cowork's control path
uses Anthropic services; Tailscale may use encrypted relays when direct
connections are unavailable. Self-hosting does not mean every integration is offline.

## From your desk to your phone

Start a task in Desktop. Leave the computer running. Read the result on your
phone and add a follow-up to the same supported session. Return to Desktop to
continue. Choose an existing project, open a session, read or reply.

<img src="assets/readme/mobile-session.png" width="340" alt="Pokite mobile web interface: a demo checkout project, agent progress and a follow-up message from a phone in the same conversation" />

*Actual Pokite UI with fictional demo content. No personal conversations,
credentials or access QR codes. This image illustrates the workflow, not a live
execution benchmark.*

## How Desktop sharing works

```mermaid
flowchart LR
    Phone["Phone / tablet browser"] -->|"LAN or Tailscale · access token"| Pocket["Pokite on your computer"]
    Desktop["Your original Desktop client"] <--> Backend["Same agent backend and session"]
    Pocket <-->|"Local adapter"| Backend
    Backend --> Project["Your existing project files"]
```

This diagram describes the **Codex Desktop and Hermes Desktop** sharing path.
Codex uses a local forwarding process; Hermes uses a local plugin. DSH and
Penguin reuse their services. Claude CLI resumes through the SDK; Cowork has a
cloud-mediated control path. They are not interchangeable transports.

## Why Pokite?

| What you want | Pokite's approach |
| --- | --- |
| Continue a session you started in Desktop | Attach to supported existing Desktop backends; no new workspace required |
| Read and reply comfortably on a phone | A responsive conversation UI, rather than a streamed desktop screen |
| Keep using your computer's setup | Execution stays on your computer; configuration and support vary by agent |
| A lightweight mobile entry point | Browser access, no Pokite mobile app or Pokite account |
| Reach your machine at home or away | LAN or your own Tailscale network; access-token authentication |

Pokite focuses on **projects → sessions → progress and replies**. It is not a
terminal emulator, a cloud coding workspace, or a replacement agent runtime.
Some integrations require explicit setup or a desktop restart; this is not
universal plug-and-play access to every installed AI app.

## Supported Agents

| Integration | Read | Reply transport | Limits |
| --- | --- | --- | --- |
| Codex Desktop, multiple profiles | Projects, sessions, conversation | Shared Desktop backend with queued follow-ups | Experimental; sharing setup and Desktop restart required; version-sensitive |
| Hermes Desktop | Desktop sessions grouped by profile and directory | Local plugin restores history and submits through the Desktop backend; Pokite queue | Experimental; Desktop must be connected; approve tools and switch models in Desktop |
| DeepSeek Harness | Existing projects and sessions | Native web API | Existing service must be running |
| PenguinHarness | Existing projects and sessions | Existing local service | Cannot change the model of an existing session |
| Claude Code CLI | Local CLI history | Agent SDK session resume | Not Desktop sharing; do not write concurrently with an external CLI |
| Claude Desktop Cowork | Sessions associated with the current account | Anthropic remote session API | **Not LAN-only control**; keychain authorization may be required; no creation, approvals or model switching |
| Claude Desktop Code / Chat | Not exposed | Unsupported | Experimental transports are disabled |

The independent Claude Code integration excludes Desktop-owned sessions. Discovering an installed agent does not mean it is connected or writable.

Hermes Desktop requires a local plugin: run `node scripts/setup-hermes-sharing.mjs`
(also pass the profile name for a named profile), then reopen Hermes after its tasks finish.
See [Hermes setup and limitations](integrations/hermes-desktop/README.md).

Claude Desktop Cowork requires `node scripts/setup-claude-keychain.mjs` on macOS.
This developer setup needs Xcode Command Line Tools and a local code-signing
identity. On first access, grant **Always Allow** to **Pokite Claude Access**.
The helper has a fixed installation path and is reused unchanged across service
restarts; credentials stay in memory. Keychain locking, item recreation, or
signing changes can require authorization again. A Developer ID signed installer
for non-developers is not yet distributed.

## Quick Start

Requirements: macOS, Node.js 22.23.0 or newer with `node:sqlite`, and your agent already installed and authenticated. Verify it works in its original client first.

```sh
git clone https://github.com/stwith/pokite.git
cd pokite
npm ci
npm run build
npm run discover
npm run setup -- --dry-run
npm run setup
npm start
```

1. Open `http://127.0.0.1:3230` on the computer.
2. Enter the access code generated in `.local/access-token`. This is a Pokite credential, not a model API key.
3. Choose an agent and project. The sidebar QR button offers LAN and Tailscale connection links.
4. Connect your phone to the selected network and scan the QR. The login page also accepts a QR image; decoding stays in your browser.

Codex starts read-only until sharing is explicitly enabled:

```sh
npm run setup -- --enable-codex
```

Wait for Desktop tasks to finish, then quit and reopen the relevant Desktop app. Setup does not restart it automatically or change model/account configuration. Instances are stored in `.local/instances.json`. Run `npm run doctor` for diagnostics.

## Connection and Security

- LAN: `http://<computer-LAN-IP>:3230`.
- Tailscale: connect both devices to the same tailnet and use the computer's Tailscale address.
- Authentication stays enabled. QR codes and pairing links contain credentials; do not publish them.
- Plain HTTP is not TLS-encrypted. Use a trusted network, or a restricted Tailscale network for remote access. Do not expose the port publicly.
- Tailscale may use DERP relays. Pokite operates no relay service; Cowork control and model inference still use the original providers' external services.

## Home Screen

After connecting, use Safari's Share > Add to Home Screen; keep Open as Web App enabled where available. Other browsers offer their own shortcut/install menu.

HTTP installation and standalone behavior depend on the OS/browser. Pokite supplies a manifest and icons, but no Service Worker, offline execution or background resubmission. A standalone window may require pairing again because its storage is separate. Live in-page camera scanning requires HTTPS; HTTP pairing uses a captured or selected QR image.

Disconnect in the sidebar clears this browser's access code and returns to the first screen. It does not stop Desktop tasks or revoke other devices. Keep the host awake and Pokite running.

## Development

```sh
node scripts/start.mjs  # Background web service
node scripts/stop.mjs   # Drain pending submissions before stopping
npm test
npm run build
npm run dev            # Frontend only; run the backend separately
```

Stopping the web service may interrupt Claude Code SDK executions it owns; it does not quit native Desktop apps. Web-service login autostart is not configured by default.

Advanced configuration retains the `POCKET_CONFIG`, `POCKET_STATE_DIR` and related environment variable names. These are runtime interfaces; the product is Pokite.

## Known Limits

- Native Codex withdrawal/edit can produce `App-server queued follow-up no longer exists`. This preview does not claim to fix the vendor client.
- Some native errors are transient rather than persisted. Received errors/retries are displayed, but recovering every historical event is not guaranteed.
- Closing a browser does not cancel submitted work. Unknown delivery is never blindly retried.
- Per-device credential revocation is not implemented; disconnecting a browser does not invalidate a copied token.
- This remains a developer preview, with installation diagnostics and cross-device acceptance still evolving.

## Contributing

Issues and focused pull requests are welcome. Include OS, Node and agent versions plus reproduction steps. Remove access codes, QR credentials, account details and private conversations from logs/screenshots.

## License

[MIT](LICENSE). Third-party dependencies retain their respective licenses.
