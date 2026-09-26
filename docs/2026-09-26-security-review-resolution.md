# Review verification and remediation — 2026-09-26

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

- Consumer distribution signing/notarization, menu bar app/Homebrew packaging,
  first-run web wizard and opt-in service autostart need separate product work.
- A full App.jsx decomposition and frontend/backend localization are broader
  maintenance changes; new device UI and state/auth services are separate modules.
- Old POCKET_* environment names and installed LaunchAgent labels remain aliases
  for migration. New public path settings use POKITE_*.
- Upstream protocol compatibility and each provider's same-session behavior still
  require version-specific checks. No automatic restart or modification of
  Codex/Claude applications was used for this review.
- This review does not migrate integrations to vendor Remote Control services or
  endorse the pasted competitor claims; that would alter the agreed product.
