# Distribution and internationalization implementation plan

> Scope update (2026-09-26): the agreed deliverable is a local-service installation package with a browser/PWA interface, not a native app. Native menu-bar and DMG work below is historical prototype evidence, not the current release plan or a release prerequisite. See [distribution scope](../macos-distribution.md).


Goal: split the application into focused views, provide Chinese/English interface and managed error translations, and build a macOS menu-bar distribution with bundled runtime.

Architecture: keep agent execution and existing transport semantics unchanged. Extract JSX views and notification navigation lifecycle from App. Use an explicit shared message catalog and language selector; never translate user conversation content. Package the existing server and static frontend behind a small native menu-bar host. Installed runtime state remains external to the bundle.

Tech stack: React, Node, shared JS catalog, Swift/AppKit, codesign, notarytool, GitHub Actions.

1. Capture literal inventory; extract login/sidebar/composer views and notification lifecycle. Validate existing UI scripts.
2. Introduce locale negotiation, UI selector, translated static text and structured server error fields. Test both languages and user-content preservation.
3. Add a protected first-run discovery dialog and explicit sharing setup controls.
4. Implement native menu-bar host, packaged runtime, start/stop/open/log/launch-at-login actions. Build with a curated file allowlist; no private state or fixtures.
5. Build a local development-signed app/DMG and verify signatures and packaged runtime. Provide release signing/notarization commands that fail closed without Developer ID and notary credentials.
6. Verify source tests, browser layouts, packaged health and archive content; update bilingual docs. Merge only after tests. No Codex Desktop restart for these changes.

Historical native-prototype gate (outside current release scope): this Mac currently has Apple Development identities only, no Developer ID Application identity. A development signature is not a notarized public release.
