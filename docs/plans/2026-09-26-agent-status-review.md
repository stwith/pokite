# Agent visibility, connection status and broker isolation

- Separate persistent visibility from live connectivity. Authenticated mobile users can read status and change visibility; privileged installation and Desktop configuration remain loopback-only.
- Enabled agents remain in the picker even when disconnected. Settings groups all discovered/configured agents by connection state.
- Probe existing services with bounded, cached checks; never launch an executor to infer connectivity. Diagnose Code configuration separately from account entitlement, which cannot be determined from local config alone.
- Share the Claude cloud catalog and native client. Skip individual corrupt Code records without taking Cowork offline.
- Serialize broker dispatch in Node. Queued requests can expire before being written, without killing the active request. Include an absolute start deadline enforced by native code. Start execution timeout on the native `started` receipt; drain stdout before delivery classification on close.
- Keep authentication based on the 100-bit shared secret; document 429 as invalid-request feedback, not a brute-force security boundary.
- Show Desktop Code approval instructions without broadening broker write permissions.

Verify queue timing/races, file corruption, shared catalog, mobile permission boundaries and visible disconnected agents. Rebuild/restart only Pokite and its request broker; do not restart Desktop clients.

## Access-code boundary

The 20-character code is uniformly generated from 32 symbols (100 bits). Authentication safety depends on this entropy, keeping the code private, and resetting it when exposed. The invalid-attempt counter returns 429 as feedback; it deliberately does not reject a valid code and is not a brute-force prevention guarantee. This preserves access recovery when stale tabs share a Tailscale Serve source. No per-device revocation is claimed.

## Remote Control diagnostics

Official requirements: https://code.claude.com/docs/en/remote-control . Check feature-flag disabling variables and configured API/third-party endpoints locally; report only variable names, never credential values. Desktop can override CLI settings, so a configured gateway is a diagnostic hint rather than proof of the running Desktop endpoint. Subscription, organization policy, retention policy and trust requirements must be checked in Desktop; local settings cannot certify entitlement. A live original bridge takes precedence over configuration hints.

## Delivered and verified

- Connection settings are available through authenticated LAN/Tailscale requests. Only visibility toggles are exposed remotely; `prepare` (installation / Desktop environment changes) is never invoked by remote toggles. Reset remains local-only.
- UI groups connected and disconnected entries. Enabled disconnected entries stay selectable and are marked on the right. Disabling preserves existing tasks and hides the entry. Visible pages refresh the agent list every 15 seconds. Provider probes share pending work; connection results cache for 10 seconds (CLI login checks for 60 seconds).
- Native broker protocol v5 rejects missing/expired deadlines before keychain or network work. Node serializes native dispatch, expires queued work locally, starts processing timeout on `started`, and classifies interrupted writes only after stdout has drained. A separate pre-start watchdog prevents a broken broker from hanging forever.
- Invalid or unreadable Code records are skipped individually; directory failure yields no local bridge associations without failing Cowork. The two adapters share one reference-counted client and catalog.
- Code waiting-for-approval messages identify Desktop as the approval location. No approval-response permissions were added.
- `npm run doctor` reports local feature-flag, gateway and third-party configuration hints without exposing secrets or modifying configuration. Account-only prerequisites are explicitly not certified by local checks.
- All 176 Node tests pass. Production build passes without bundle-size warnings.
- Native self-tests include expired and missing deadlines and pass without keychain access. Regression tests cover late started receipts, queued expiry while another POST succeeds, shared catalog leases, corrupt records and remote visibility toggles.
- Chromium and WebKit mobile tests pass for non-local hostname access, both status groups, disconnected picker text and hiding a disabled agent. Live Tailscale HTTP discovery returns 200.
- The deployed broker update requires macOS Safe Storage authorization; until granted the two Claude Desktop entries show disconnected with a specific authorization notice. Other agent checks remain usable.
