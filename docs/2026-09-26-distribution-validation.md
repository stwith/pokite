# Distribution and i18n validation

> Scope update (2026-09-26): the agreed deliverable is a local-service installation package with a browser/PWA interface, not a native app. Native menu-bar and DMG work below is historical prototype evidence, not the current release plan or a release prerequisite. See [distribution scope](macos-distribution.md).


## Completed locally

- Login, sidebar, conversation and composer extracted into independent views.
- Notification lifecycle/navigation and model settings extracted into hooks.
- Explicit Chinese/English catalog covers all instrumented UI strings. Browser
  preference and language selector supported. Known server errors/status fields
  use Accept-Language; user content, JSON inside messages, names and paths stay
  unchanged. Push outcome labels follow the subscription locale.
- Authenticated setup dialog discovers local agents, preserves existing instance
  configuration, and offers explicit Codex/Hermes setup actions.
- Native macOS 13+ menu bar host implements open/setup/start/stop/restart/log,
  optional launch at login and integration removal. It reuses a running service.
- Standalone Node and production dependencies are bundled from an allowlist.
- Apple Development signed ARM64 app and DMG produced. Signature verification,
  bundled Node, empty-state server authentication and native-host startup passed
  in isolated temporary state; real agent execution was not started.
- Public release/notarization scripts and a manual GitHub workflow are provided.
  They fail closed without the required Developer ID identity/credentials.

## Verification evidence

- 147 unit/integration tests passed, including catalog coverage and preservation
  of conversation content and Date values.
- Production Vite build passed with no oversized-chunk warning.
- Chromium and WebKit: Chinese/English session display and send labels checked
  at mobile width, with no page errors or horizontal overflow.
- Both engines: language switch preserved an existing draft and conversation.
- English setup dialog: discovery results and explicit save interaction checked
  against synthetic APIs; no real sharing configuration changed by the UI test.
- Packaged artifact scan found no .local, .git, access-token, push.json or .env.
- Native menu-bar executable started its bundled service with isolated state;
  existing Desktop processes and the production service were not touched.

## Historical native-prototype gates (outside current release scope)

This machine has Apple Development identities but no Developer ID Application
identity. The generated DMG is development-signed, **not notarized** and not a
public release. A Developer ID Application identity plus an authorized notarytool
profile are required to complete public distribution. Intel/native device testing
and install/upgrade acceptance on another Mac remain separate gates. No claim of
Windows/Linux or universal binary acceptance is made.
