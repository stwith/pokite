# Desktop Code creation: implementation investigation

Date: 2026-09-27. Installed application inspected: Claude Desktop 2.9939.2,
embedded Claude Code 2.1.281. This is an implementation plan, **not a completed
creation integration**. No app patch, gate override, environment registration or
new execution session was performed during this investigation.

## Confirmed native path

The installed `index.chunk-Cw19c-e2.js` contains `initRemoteControlServe`, a
controller with `setServeIntent`, folder registration, work polling and
`startRemoteSession`. Its session adapter calls the existing Desktop manager's
`startSession(..., {remoteControl: ...})`, then `ensureRemoteControlSession`.
A newly admitted task therefore can become a real Desktop-owned local session.

The intended end-to-end route is:

1. Desktop obtains its normal authenticated feature/configuration response.
2. User enables the native receiving service and approves an existing project
   folder. Desktop registers a folder environment with metadata
   `worker_type: claude_code`, `runner: desktop` and a spawn mode.
3. Pokite resolves an existing project to that Desktop-owned `environment_id`.
4. Pokite submits a native session creation request. The bundled web client uses
   `POST /v1/code/sessions` with environment, config, events and tags. Its normal
   helper creates with an empty initial event list and posts the initial message
   afterwards; do not assume atomic initial-message support without testing.
5. Desktop polls and acknowledges the work, validates trust/capacity/policy,
   starts its own session and attaches its Remote Control bridge.
6. Pokite waits for a local `local_*.json` ownership record and its matching
   canonical bridge ID, then uses the already implemented bridge reply path.

This route uses Anthropic's Remote Control service between the controller and
Desktop. It is not a pure LAN session-creation protocol, even if the phone reaches
Pokite over LAN/Tailscale. It does not require a new Pokite relay.

## Why the current installation cannot activate it normally

- Fresh Desktop feature-cache observation: serve gate `1183214304` is false;
  accept-work gate `3764441751` is true. The serve initializer returns when the
  first gate is false. The accepting gate alone is insufficient.
- No `remote-control-state.json` exists on this installation; no native receiver
  environment has been verified.
- `RemoteControlServing.requestEnable` is an Electron IPC method. Its handler
  checks that a controller exists and is permitted; otherwise it returns
  `unavailable`. It also presents a native confirmation for widening access.
- The observed settings UI exposes auto-connect for new sessions, not receiver
  activation. `remoteControlAtStartup` is auto-connect, not a substitute for the
  receiver gate. Official documentation also defines it that way.
- `CLAUDE_DEV_FORCE_GATES` is explicitly ignored when `app.isPackaged` is true.
  Adding it to this production install's environment will not solve the issue.
- Editing receiver state or pinning folders cannot instantiate a controller
  whose initializer returns at the feature gate. Such edits would also bypass
  normal consent and trust accounting; they were not attempted.

The false value is a local snapshot of the service's feature response, not proof
of why the vendor disabled the feature (rollout, product policy, account or other
eligibility). We cannot promise a release date or claim updating/restarting will
unlock it. The receiver additionally checks subscription entitlement, organization
policy, feature freshness, startup settings and workspace trust.

## Pokite implementation once the native receiver is available

1. **Discovery:** resolve account/org-scoped receiver state. Cross-check an actual
   live environment, canonical trusted folder, Desktop ownership and freshness.
   Only existing projects with a live receiving environment gain `canCreate`.
   Do not select an arbitrary cloud or CLI environment with the same folder name.
2. **Broker validation:** add a narrowly shaped create operation accepting an
   existing environment ID, bounded first message, selected Code model/effort,
   and a stable Pokite operation ID. Native broker must independently validate
   ownership and allowed fields. Do not expose worker registration, work secrets,
   arbitrary settings or permission escalation through the browser.
3. **Create ledger:** persist `creating -> created(sessionId) -> initial-message
   submitted -> desktop-attached`. Native `submitting` determines uncertainty.
   A timeout after creation never automatically creates another session. If
   creation succeeded and first-message delivery failed, resume against the
   persisted session ID instead of recreating. Keep Desktop-not-yet-attached
   separate from not-created.
4. **First message:** reproduce the verified native client's sequencing. Use a
   stable message UUID and reconcile the native echo. Do not assume a custom
   HTTP idempotency header is supported.
5. **Ownership acceptance:** success requires a local Desktop session record,
   matching bridge ID, correct originating project, and the first message in
   both the native transcript and mobile history. A successful HTTP create alone
   is not success.
6. **UI:** show creating/awaiting Desktop/ready, precise unavailable reasons, and
   one session transition without losing the draft. Respect selected model and
   effort through existing controls once attached.
7. **Validation:** real no-tool marker in a known existing project; Desktop and
   mobile visibility, model confirmation, one-and-only-one creation; disconnect
   before/after submitting; first-message failure after successful creation;
   account switch, untrusted directory, unavailable Desktop and capacity limit.

## Alternative routes assessed

| Route | Result |
| --- | --- |
| Native receiver above | Correct Desktop ownership; blocked by currently disabled vendor gate. Preferred when available. |
| Dispatch `start_code_task` | Officially creates Desktop Code sessions, but requires an agent tool invocation and may ask for workspace approval. Not an equivalent deterministic create API. No tested direct external tool invocation is available. |
| Internal Electron `startSession` IPC | Creates the right object, but IPC is bound to trusted Desktop renderer/sender checks; no supported local HTTP/socket bridge identified. Requires an invasive app integration, not a normal config change. |
| `claude://code/new` | Opens/prepares the desktop composer; does not prove unattended session creation. |
| Independent CLI / SDK worker | Can create work but violates the required Desktop-owner execution path. |
| Patch app / feature cache | Not a stable distributable integration; invalidates assumptions about signatures, updates, consent and eligibility. Not attempted or recommended for Pokite. |

## Sources

- Installed app main chunks `index.chunk-Cw19c-e2.js` and
  `index.chunk-DzZc-q0x.js`: native receiver, gate initialization and IPC consent.
- Bundled web `shared-4-DXx7l4vW.js`: `wW` create-body transform and `lq` sequential
  create/initial-message helper.
- https://code.claude.com/docs/en/desktop#sessions-from-dispatch : documented
  Dispatch-created Code sessions in Desktop.
- https://code.claude.com/docs/en/remote-control#enable-remote-control-for-all-sessions :
  auto-connect semantics, distinct from a Desktop receiving environment.

No production behavior changed in this investigation. The prior version-bound,
read-only availability diagnostic remains the only delivered change related to
new-session support.
