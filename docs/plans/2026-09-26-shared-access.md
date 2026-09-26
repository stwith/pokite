# Personal-use shared access

Confirmed requirement: one persistent access code for the owner's devices and
all three network URLs. Remove one-time tickets, credential exchange, device
registries and individual device revocation. The code changes only on explicit
reset; this migration retains the existing access-token file unchanged.

- Authenticate API requests directly against the same code on LAN and Tailscale.
- QR codes and links contain that code; browser origins save it independently.
- Login verifies access without generating or consuming any credentials.
- Local connection dialog offers a two-step global reset. Keep CLI reset for
  recovery while the service is stopped.
- Reset atomically replaces the saved code, closes old event streams, rejects old
  requests and clears notification subscriptions. Preserve agent accounts,
  sessions and accepted work. The resetting browser saves the new code.
- Keep setup and reset local-only, including rejection of loopback proxy traffic.
- Retain Tailscale detection/reconciliation, runtime update/preflight and cleanup.

Validation: API tests for reusable shared authentication, remote administration
rejection, reset persistence, stream closure and CLI locking. Chromium/WebKit
exercise repeat login, two origins using one code, reset UI and reconnection.
Live validation must reuse one code across LAN HTTP and both Tailscale URLs;
never reset the production code just to test the reset feature.

Executed: 133 tests and production build passed. Chromium/WebKit verified the
shared code on two origins, repeat use and the reset/reconnect UI. The running
Mac service was restarted without restarting Codex or changing its access code.
LAN HTTP, Tailscale HTTP and HTTPS all accepted that same code repeatedly and
returned it in connection links; remote reset was rejected with 403.
