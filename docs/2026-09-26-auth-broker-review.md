# Access expiry and broker delivery review

This is the current follow-up to the archived [earlier review](archive/2026-09-26-security-review-resolution.md). The product continues to use one owner-managed persistent access code across LAN/Tailscale.

## Changes

- Pokite access failures carry `ACCESS_REJECTED`. The client clears only the rejected current credential, aborts pending reads, stops SSE/retry timers and resource polling, and returns to login. Provider-side 401 errors remain visible without invalidating the Pokite code. Delayed responses from an old code cannot clear a newly saved code.
- Correct credentials are checked before failed-attempt throttling. Authenticated clients remain usable even when old tabs or guessing attempts exhaust a failure bucket. Direct localhost administration is exempt; forwarded headers are accepted as peer identity only after verifying a loopback connection and the configured private Tailscale Serve host. Prefer the final forwarded IP, then the verified Tailscale user identity. There is no shared global lockout bucket.
- Native protocol v4 emits `started` with the request ID before handling a request. The client distinguishes requests merely written into the pipe from ones actually begun. An unstarted POST is `not-sent` after timeout/exit; a started POST with no reply remains `unknown`. Child `close`, not `exit`, drains the final stdout protocol events before classifying pending requests.
- Native requests have a 50-second total budget; each upstream request is bounded by its remaining time. Cloud membership pagination stops at the budget instead of permitting 100 unbounded waits. The queue must never automatically duplicate an uncertain write.
- Model/effort control failures explicitly say the settings may already have changed, while the message itself was not sent. Readback caches are invalidated and the unsent text remains editable.
- Native compilation is allowed 180 seconds. The setup subprocess has 210 seconds and the browser setup request 240 seconds, so cold compilation is not cut off by the previous 60-second outer timeout.

## Fresh keychain authorization

The broker now always installs at `~/Library/Application Support/Pokite/Cowork/Pokite Cowork Access`, identifier `app.pokite.cowork-request-broker`. It never chooses the legacy key-export helper path or identifier. Ad-hoc signing is the default; a named signing identity requires explicit configuration.

Inspect old grants with:

```sh
node scripts/macos/retire-cowork-authorization.mjs
node scripts/macos/retire-cowork-authorization.mjs --apply
```

This utility examines only Claude Safe Storage access lists and removes the exact retired Pokite executable entry. It never reads the secret, deletes the keychain item, or removes Claude/other applications. macOS may require owner authorization to edit an access list. The new broker may separately require a fresh access approval. These are real system gates, not a reason to preserve or inherit the old grant.

## Validation

Regression tests cover peer isolation, valid-code recovery, localhost exemption, queued vs started POST classification and bounded broker behavior. Chromium/WebKit verify expiration returns to login, future online/focus/visibility events do not restart traffic, upstream 401 does not log out, and the new code reconnects. Native self-tests remain keychain-free. Real authorization outcome and live deployment are recorded after execution.

## Executed verification

- Old Claude Safe Storage authorization cleanup found and removed exactly one
  retired Pokite trusted-application entry. A second read-only inspection found
  zero remaining retired entries. The secret and Claude's own access were not changed.
- New broker installed at its dedicated path with the new identifier and local
  ad-hoc signing. No certificate/identifier inheritance from the old helper.
- Chromium and WebKit tested access expiration, stopped polling/SSE, provider-side
  401 preservation, replacement-code reconnect and reset UI behavior.
- Native protocol self-tests passed without credentials.
