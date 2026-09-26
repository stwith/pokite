# Claude Cloud Controls and Loading Implementation Plan

**Goal:** Improve metadata/history loading and support new sessions, model selection and effort for the existing Claude Desktop cloud integration.

**Architecture:** Retain the native credential boundary and current account isolation. Use the current Desktop frontend's actual creation and control-event formats. Validate against live model/effort catalogs. Keep non-idempotent delivery uncertainty explicit; do not retry session creation after an unknown outcome.

**Tech Stack:** Existing Node adapter/catalog, Swift request broker, React model/composer controls, Node/native/browser tests.

## Baseline and evidence

Measured with the current account: cold project discovery ~2085 ms, warm ~12 ms; cold detail ~790 ms, warm ~9 ms. Project fetching and session fetching share a 5-second cache, causing unnecessary project/account calls. The broker processes upstream calls serially.

Installed Desktop frontend sources identify:
- POST `/api/organizations/{org}/cowork/sessions` with model, effort_level, optional project_uuid and initial message/message_uuid.
- Event controls `set_model` and `apply_flag_settings` restricted to `effortLevel`.
- Per-model allowed effort options from `model_selector_config`.

## Execution

1. Discover the authenticated model/effort catalog and exact creation payload with read-only requests/source inspection.
2. Separate stable project caching from frequently updated session metadata; reuse fresh list metadata for the first detail and retain identity checks.
3. Extend native validation narrowly for model reads, session creation and the two permitted control actions. Reject arbitrary settings, tool-permission changes and worker actions.
4. Wire new-session creation and model/effort selections into existing controls. Require acknowledgement/readback before sending a message after setting changes.
5. Test duplicate/uncertain creation handling, denied controls, account changes, model validation and cache performance. Verify in one clearly labeled cloud test session in an existing project.
6. Build, deploy only Pokite, verify live webpage paths, update docs, commit/push and remove the temporary checkout.

## Verification so far

- Read-only bootstrap returned the account's current Cowork model options and per-model effort choices; no static model list was introduced.
- One clearly labeled test session was created in an existing cloud project with its initial no-tool instruction, using Sonnet 4.6 / low. An assistant reply was received.
- The same session accepted acknowledged controls for Sonnet 5 / medium; a subsequent no-tool message received a reply and metadata readback confirmed both settings.
- After optimization, a local sample measured cold detail ~374 ms versus ~790 ms before. Warm project/detail reads were ~8–17 ms. Cold project load remained ~2.2 seconds, so no improvement is claimed there. A session-catalog refresh reused the existing project cache instead of fetching projects again.
- Chromium and WebKit mobile fixtures exercised new-session creation and model/effort choices on existing sessions. Native validation rejects arbitrary permission/flag settings.

## Implementation checks

- Native protocol v3 validates atomic creation and model/effort-only controls; arbitrary flags/permission changes remain rejected. Bootstrap output is restricted to the relevant model surface.
- New-session HTTP requests call the atomic provider path once, rather than creating and then submitting the same first message again. Lost responses remain uncertain and are not recreated automatically.
- Model/effort control errors leave an editable blocked queue item explicitly marked Not sent.
- 160 Node tests, native self-tests, production build, and Chromium/WebKit mobile interaction checks passed.
