# macOS menu-bar distribution

The app is an optional native launcher for the existing local service. It does
not run another agent. It bundles Node, production dependencies, the web build,
server and required setup scripts. Private state, Git history, tests and proof
artifacts are excluded. Requires macOS 13 or later.

## Using the app

1. Drag Pokite.app into Applications and open it.
2. Use the menu-bar item to open Pokite or **Set up agents**. First use opens the
   setup page automatically. The browser receives a local pairing credential;
   it is not embedded in the distributed app.
3. Discover and save existing agents. Explicitly enable Codex sharing or install
   the Hermes plugin as needed; finish current tasks before reopening that agent.
4. Restart Pokite from the menu after changing instances. Scan its connection QR
   from your phone. HTTPS/Tailscale still requires the corresponding network setup.

The menu offers Start, Stop, Restart, View log, optional Start at login, and Remove
integrations. Quitting the menu bar leaves the service running. Removing launch
integrations preserves accounts/session data; stop the service before removing
the app. A running development service is reused rather than duplicated.

## Build locally

```sh
npm ci
POKITE_SIGN_IDENTITY='Apple Development: Your Name (TEAM)' npm run mac:build
npm run mac:verify
```

Output: `artifacts/macos/Pokite.app` and an architecture-specific development DMG.
An Apple Development signature verifies local identity; it does **not** make the
artifact an approved public download. Do not label a development DMG notarized.

The build uses a standalone Node distribution with system-only dylib references.
Set `POKITE_NODE_BINARY` and `POKITE_NODE_LICENSE` when supplying a different
standalone Node. It rejects Homebrew-linked binaries with external dylibs.
Source builds still support the CLI workflow; no signing identity is needed for
ordinary `npm start` usage.

## Public release gates

```sh
POKITE_SIGN_IDENTITY='Developer ID Application: Your Name (TEAM)' \
  node scripts/macos/build.mjs --release
POKITE_NOTARY_PROFILE='your-existing-notarytool-profile' \
  npm run mac:notarize -- artifacts/macos/Pokite-0.2.0-arm64.dmg
```

The public build requires Developer ID Application. Notarization submits the DMG
to Apple, waits for acceptance, staples the ticket, then checks Gatekeeper. This
requires the developer's valid Apple distribution identity and notarytool
credentials. Source control contains no certificates, passwords or API keys.
Build both architectures on matching runners before declaring universal support.

## Language and application structure

The browser offers 中文 / English on login and in the sidebar. It follows the
browser language initially and persists an explicit preference. Changing language
reloads the UI; drafts are already persisted by the composer. User messages,
session names, paths, model identifiers and provider output are not translated.
Known server errors and status descriptions follow Accept-Language; push outcome
labels follow the subscribed device language.

Views live in `src/components/views/`; notification routing/lifecycle is in
`src/hooks/use-notification-navigation.js`. Shared UI/server wording lives in
`shared/messages.mjs`; catalog coverage and user-content preservation are tested.
