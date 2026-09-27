# Separate Claude Desktop surfaces

## User intent

Expose `Claude Desktop Cowork` and `Claude Desktop Code` as separate agents. Cowork retains the current account's unified cloud Chat/Cowork sessions. The independent `Claude Code CLI` entry remains separate and excludes Desktop-owned transcripts.

## Implemented

- `claudeDesktop` retains the Cowork identity; `claudeDesktopCode` exposes only current-account, Desktop-owned Remote Control bridges. Direct session reads and writes obey the same boundary as project lists.
- Code projects use the workspace basename without a redundant `Code ·` prefix.
- Discovery and setup can enable each surface independently. Both adapters share one reference-counted native authorization broker.
- Code model menus use `ccd` / `cc` / `code` model-selector surfaces; they never fall back to Cowork/chat models. Native validation makes the same choice using the current account's local bridge ownership, not an untrusted browser flag.
- Selection applies through `set_model` and `apply_flag_settings` on the existing bridge before the next user message. Both acknowledgments are required. No uncertain message is automatically replayed.

## New-session investigation and remaining blocker

Inspected the installed Claude Desktop 2.9939.2 application and embedded Code 2.1.281. Desktop internally implements `dispatch.start_code_task` through a session-manager `startSession` callback. That path checks workspace trust, creates a Desktop-owned host session and may use worktree isolation. It is an internal SDK MCP tool, not an externally available HTTP creation endpoint.

The per-session Code Remote Control REPL dispatcher supports model and flag-setting controls but does not expose that Desktop session-manager callback. SDK MCP messages are not a generic route to invoke Desktop internal tools through Remote Control. The `claude://code/new` deep link opens the new-session UI; it does not establish that Pokite can submit a session without UI interaction.

Consequently **Code creation is not implemented**: its adapter has no `createAndSend`, and projects remain `canCreate: false`. Do not use the Cowork cloud creation route, spawn an independent CLI executor, or simulate the composer as substitutes. A ready Desktop receiver environment is required before enabling this capability; see the follow-up below.

## Validation

- Unit regressions cover provider isolation, direct cross-surface access rejection, separate model catalogs and missing Code catalog failure.
- Native broker route/encryption self-test passes.
- Chromium and WebKit cloud creation/model-control UI regressions pass (fixtures, not live Code creation).
- macOS authorization completed. The live service returned one Code workspace with two connected original Desktop sessions and the account's Code-specific model catalog.
- Live idle-session control test changed Sonnet 5 / high to Sonnet 4.6 / low. Both controls were acknowledged and server metadata confirmed the new model and effort. The original Sonnet 5 / high settings were then restored with acknowledgment. No user turn or inference task was sent.
- Live mobile-sized Chromium page opened the original Code session and displayed the Code-specific model options.
- 168 Node tests passed. Existing Code reply acceptance was verified in the previous iteration; this round verifies model controls separately.

## Upgrade

Enable the new Code entry in local Agent settings. Do not silently migrate in-flight operations between adapter IDs. This installation's local configuration was updated to enable both entries. Existing Cowork IDs are unchanged; previously bookmarked Code links under the combined agent need to be selected from the new Code entry.


## 2026-09-27: native receiver found, unavailable in the running Desktop

The previous investigation was incomplete: bundled `index.chunk-Cw19c-e2.js`
contains a native Remote Control **serve** controller. It registers a Desktop
folder environment, polls for work, and calls Desktop's own `startSession`
through `startRemoteSession`. This is a valid architectural candidate for
creating Desktop-owned Code sessions without a second CLI executor or composer
automation. It is separate from per-session reply controls and Dispatch MCP.

Observed on this Mac, Desktop 2.9939.2:

- Fresh local `fcache` contains serve gate `1183214304` as `on: false`.
- Accept-work gate `3764441751` is true; this alone does not start the receiver.
- `remote-control-state.json` does not exist; no native served-folder registration
  was found. The receiver initializer explicitly returns before constructing a
  server when the serve gate is false.
- The actual Desktop settings show “Connect new sessions to Remote Control”,
  which connects sessions after local creation; no native receiver control is
  exposed in this settings view.
- The bundled web client creates through `POST /v1/code/sessions` with a selected
  `environment_id`, config and events. Calling it without an active,
  Desktop-owned receiver would not prove local Desktop creation. No such POST
  was sent.

Creation remains unimplemented/unverified. This turn did not override feature
flags, edit Claude's application, register an independent environment or launch
an independent executor. Added a read-only, version-bound diagnostic for the
observed gate, with bounded decompression and cache freshness checks. If the cache
includes an organization, it must match the current catalog. A cache without one
is a device feature snapshot and is not proof of account entitlement. Other app
versions and missing/stale/invalid data return unknown. Enabled gate means only
“detected”, never “supported” until actual receiver and creation verification.

Next viable step: once Desktop exposes and enables its native receiver for this
installation, restrict creation to its registered existing project environments,
submit once with delivery tracking, and require original Desktop local-session
ownership plus a bridge echo before reporting success.
