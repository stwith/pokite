# Hermes Desktop Local Bridge

Experimental macOS integration. Verified against the locally installed Hermes
Desktop 0.17.0 shell and its 0.20.4 runtime. Internal gateway APIs can change;
an HTTP endpoint alone does not imply compatibility with every Hermes release.

Run `node scripts/setup-hermes-sharing.mjs` from the Pokite repository. For a
named Hermes profile, also run `node scripts/setup-hermes-sharing.mjs main`,
substituting the profile name. Restart Hermes after its tasks finish. Add a
`hermesDesktop` provider instance with the Hermes root as `home` to an existing
Pokite configuration; fresh discovery includes it automatically.

The installer enables a narrowly scoped dashboard API plugin. It does not grant
built-in tool overrides, replace the app bundle, start another agent, or expose
a new listener. Pokite discovers only same-user Python children of Hermes.app,
reads their ephemeral session credential in memory, and reaches their existing
loopback HTTP endpoint. Credentials are never sent to the browser or logged.

Direct WebSocket prompt submission is intentionally NOT used: Hermes rebinds
the session event transport to the sender. The plugin binds the original owner
before invoking the native prompt handler. Read-only snapshots include running,
waiting and retained error state without changing session ownership.

Historical sessions must first be opened in Desktop. New sessions require an
existing Desktop connection and an existing project. Native approvals and model
selection remain in Desktop. Pokite's queue handles busy sessions; it does not
replay uncertain submissions. Polling exposes snapshots rather than a second
native event subscription.

Disable with `hermes plugins disable pokite`, or
`hermes --profile main plugins disable pokite`, then restart Hermes. Removing
the corresponding `plugins/pokite` directory afterward removes the plugin;
accounts and session databases remain untouched.

Real-device verification is separate from browser tests. The initial real
Desktop test confirmed phone-origin text in the original conversation, continued
Desktop event delivery, and the same upstream HTTP 503 error in both clients.
That verifies the control path, not a successful model response on an unavailable
provider account.
