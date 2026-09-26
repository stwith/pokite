# Review verification and remediation — 2026-09-26

> Cowork update: the key-export helper remains retired. Unified Chat/Cowork now uses cloud catalog discovery through a signed,
> request-only native broker, verified against the original account/session. See [implementation and live validation](cowork.md). Earlier
> statements below about Cowork being disabled describe the remediation stage.


> Authentication policy update: the owner explicitly chose a personal-use shared
> access code. The per-device/one-time-pairing findings and fixes below are
> historical; they are superseded by [the shared-access design](plans/2026-09-26-shared-access.md).
> One persistent code now works on LAN and Tailscale, with an explicit global
> reset. Local administration, network/runtime fixes and retired-code removal remain.


The supplied review was treated as findings to verify, not as implementation
instructions or proof of third-party product capabilities. This change addresses
the concrete defects in the current repository; it does not claim a signed
consumer installer, a complete i18n redesign, or universal upstream compatibility.

| Finding | Evidence / disposition |
| --- | --- |
| Launcher depends on another application's Node and repository path | Confirmed. Setup now installs a private runtime copy and launcher under Application Support. Missing/unusable runtime, missing proxy or dependencies falls back to the configured native binary. Added explicit uninstall command to disable sharing and remove only owned environment/config overrides. Active Desktop processes are not restarted. |
| Keychain helper exposes Claude master key to any caller | Confirmed. Pipe-only stdout is not caller authentication. Removed helper source/installer/reader and the installed executable; runtime registration excludes Cowork. The remote client fails closed without an explicitly injected test credential reader. No claim of a service-terms violation: that was not established. |
| Default HTTP listener exposes high-privilege access on LAN | Confirmed. New installs bind loopback plus verified local Tailscale IPs only. LAN wildcard binding requires explicit opt-in. This existing installation retains its previously authorized LAN usage in local network.json. HTTPS Serve remains private and functional. |
| Shared credential cannot revoke one device | Confirmed. Pairing now exchanges ten-minute single-use codes for per-device random credentials; only hashes are stored. Added device list/revoke UI, rejection of revoked requests, SSE closure and associated push cleanup. The local bootstrap secret remains a recovery credential; possession of that secret permits re-pairing. |
| Unbounded JSON records retain message bodies | Confirmed. Completed operation results and terminal queue bodies have seven-day, count and 2 MiB per-store limits; hourly/startup maintenance. SQLite retains only hashed request IDs and fingerprints, preserving replay protection. Pending/uncertain entries are intentionally retained. Minimal deduplication metadata still grows with unique request IDs. |
| 11 GiB of proof fixtures in repository state | Confirmed. 39 unused proof directories moved to a private Trash directory, not permanently erased; actual disk space is released only after Trash is emptied. Remaining state moved to Application Support. One ignored .local symlink keeps active Desktop path references working without copying data. Future shared proofs use system temp and clean up in finally. |
| Uncertain entry blocks queue | Expected safety behavior. Added explicit UI explanation: confirm original session, remove the uncertain record to continue; removal does not undo executed work. |
| requestId reused across agents/sessions/content | Confirmed. Queue verifies full input fingerprint, including model, and returns 409 on mismatches, including retired receipts. |
| Codex monitor always starts | Confirmed. Instantiate and schedule it only when Codex is configured. Notification language follows POKITE_LANGUAGE/LANG with English fallback. |
| Read acknowledgements bypass coordinator | Fresh read is intentional to prevent acknowledging unseen output. Added an independent acknowledgement coordination key; overlapping acknowledgements can share work without reusing an older GET snapshot. |

## Verification

Final checks: 144 automated tests passed; production build passed. Both local
HTTP and private Tailscale HTTPS returned 200; both running Codex instances'
project reads returned 200. Runtime state is about 139 MiB including the owned
Node binary, down from the previous 11 GiB repository-local tree. Queue JSON
was reduced to about 35 KiB and operations JSON to 216 bytes after payload
retention, with replay fingerprints preserved separately.

- Automated tests cover native fallback, independent/revoked device credentials,
  one-use pairing, endpoint isolation, queue collisions, expired receipt replay
  prevention, safe listener selection and disabled credential access.
- Existing startup, persistence rollback and queue ambiguity tests remain gates.
- HTTPS live check: pair 200, authenticated read 200, reused code 401, revoked
  credential 401. Temporary verification device revoked afterward.
- Chromium and WebKit mobile UI: device list renders and revoke removes only the
  selected entry; no horizontal overflow or page errors.
- Installed runtime tested with --version; on this Mac its dynamic dependencies
  are system libraries, not Hermes or Homebrew libraries.

## Remaining product work, not claimed complete

- Updated distribution scope: ship a local-service installation package with a
  browser/PWA interface, not a native app. The package is not released yet; clean
  installation, updates, removal and opt-in service autostart need acceptance.
  See [distribution scope](macos-distribution.md).
- Follow-up work delivered the first-run web setup dialog, focused App views and
  frontend/backend localization; see [validation](2026-09-26-distribution-validation.md).
- Old POCKET_* environment names and installed LaunchAgent labels remain aliases
  for migration. New public path settings use POKITE_*.
- Upstream protocol compatibility and each provider's same-session behavior still
  require version-specific checks. No automatic restart or modification of
  Codex/Claude applications was used for this review.
- This review does not migrate integrations to vendor Remote Control services or
  endorse the pasted competitor claims; that would alter the agreed product.

## Follow-up review: pairing, local administration and runtime recovery

The native app/DMG route has been retired. The product remains a local service
installation with a browser/PWA interface. This round addresses the follow-up
findings as follows:

| Finding | Resolution |
| --- | --- |
| Paired phones could mint replacement credentials | Pairing-code generation requires authenticated direct localhost access. Remote connection links contain no pairing or device token. Device administration is local-only too. |
| Native launcher repeatedly paired and exposed the master in a URL | Native launcher/build workflow removed. `npm run open` exchanges the master over loopback for a single-use ticket. Browser startup keeps its saved credential; it uses the new ticket only if the saved credential is rejected. |
| Old master links remained usable | Master authentication is local-only. `npm run rotate-token` atomically replaces it while holding the service lock; stored devices are bound to the master's hash, so old device credentials cannot survive a restart. Startup drops subscriptions without a valid device owner. Upgrade instructions require a one-time reset. |
| App-installed Tailscale had no PATH CLI; listeners went stale | Shared command runner tries PATH and `/Applications/Tailscale.app/Contents/MacOS/Tailscale`. Listener reconciliation runs every 10 seconds. HTTP links require a confirmed tailnet IP and a successfully bound listener (or explicit LAN wildcard listener). Losing a listener closes its connections, without stopping loopback. |
| Owned Node copy never updated; fallback missed import errors | Compare content hashes, validate changed runtime and proxy imports, then atomically replace. Launcher runs a side-effect-free proxy preflight before handing over; syntax or dependency failures fall back to native Codex with original arguments. |
| Phones could change launch integration; discovery blocked requests | Discovery/configuration require authenticated direct localhost. Loopback proxy traffic is not trusted as local administration. Discovery runs in a worker with a timeout and coalesces concurrent scans. |
| Concurrent pairing could reuse a ticket | `pair()` revalidates expiry and consumes the ticket synchronously before creating a device. A persistence failure does not restore a potentially exposed ticket. |
| Setup failures were invisible in logs | Log the setup exception server-side; return a generic localized error to the browser. |
| Disabled Cowork transport/diagnostics remained callable | Remove Desktop remote/client/credential/event/history modules, Safe Storage probe scripts and their obsolete tests; remove the integration factory/default and UI ordering entry. CLI ownership filtering remains. |
| Native package versions/Intel matrix disagreed | Remove the native app packaging targets and workflow. Shared RPC client metadata reads the package version. No Intel or clean-machine installer acceptance is claimed. |

### Verification

- Automated regressions cover authenticated localhost vs forwarded requests,
  remote master rejection, pairing-code competition/expiry/persistence failure,
  credential rotation and refusal while a service lock exists, app-binary
  Tailscale fallback, listener reconnect/removal/bind failure, URL filtering,
  native launcher fallback on syntax/import failures, runtime replacement and
  asynchronous discovery responsiveness.
- `scripts/verify-device-login.mjs` exercises real Chromium and WebKit against
  an isolated service: initial pairing, repeated open without another device,
  and re-pair after revocation. Only synthetic credentials are used.
- Removed tests covered the retired native/Claude Desktop integrations, not the
  supported Claude Code CLI or Codex execution paths.
- A clean Mac with the App Store Tailscale build is still a separate release
  acceptance step; a simulated missing PATH command is not that device test.

### Deployment boundary

Only Pokite needs a restart to activate HTTP/auth/network changes. Existing Codex
processes are not restarted. Updating the on-disk launcher/preflight affects the
next normal Desktop launch. Credential reset signs out phones and removes their
notification subscriptions; pair and enable notifications again. It does not
change model accounts, sessions, shared-backend tokens or task queues.

### Executed on this Mac

- 135 tests passed; production build passed without the oversized-chunk warning.
- Chromium and WebKit login regressions passed, including same-document
  `#token` navigation when reopening a revoked browser.
- Updated the owned launcher and restarted only Pokite. Rotated the master once.
- LAN HTTP, Tailscale HTTP and Tailscale HTTPS each returned 200 for the temporary
  paired device, rejected the new master remotely with 403, and did not issue
  remote pairing tokens. The old master returned 401 on localhost.
- Both Codex instances' project endpoints returned 200. No test messages were
  sent to real agents. The temporary verification device was revoked afterward.
- Phones must pair again and re-enable notifications following the reset.
