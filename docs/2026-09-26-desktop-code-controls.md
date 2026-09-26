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

The Code Remote Control REPL dispatcher supports model and flag-setting controls but does not expose that Desktop session-manager callback. SDK MCP messages are not a generic route to invoke Desktop internal tools through Remote Control. The `claude://code/new` deep link opens the new-session UI; it does not establish that Pokite can submit a session without UI interaction.

Consequently **Code creation is not implemented**: its adapter has no `createAndSend`, and projects remain `canCreate: false`. Do not use the Cowork cloud creation route, spawn an independent CLI executor, or simulate the composer as substitutes. A new integration point is required before enabling this capability.

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
