# Cowork Safe Restore Implementation Plan

**Goal:** Restore existing Claude Desktop Cowork projects, history and replies without exporting the Desktop Safe Storage master key.

**Architecture:** Keep local project/session discovery and the same upstream Cowork session API. A signed, stdio-only native request broker reads credentials internally and performs an allowlisted set of requests. Neither the master key nor OAuth tokens are returned to Node or the browser. Desktop Code/Chat remain excluded. This is local phone access with provider session API traffic, not a pure local Cowork protocol.

**Tech Stack:** Node/React, Swift Foundation/Security/CommonCrypto, existing queue and receipt handling, Node tests and isolated browser checks.

## Research

- Official cross-device Cowork documentation describes the vendor's account/cloud experience, not a public local management API: https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile
- cc-tap reads CLI OAuth and uses session APIs. Useful separation of credentials from session operations, but it connects Code Remote Control; local CLI credentials checked on this machine do not contain Cowork-capable OAuth: https://github.com/es617/cc-tap/blob/main/cc_tap/auth.py
- claude-bridge offers MCP-mediated inter-session messages, not arbitrary existing Desktop session control: https://github.com/Mugyen/claude-bridge
- claude-cowork-service documents the Linux execution daemon; replacing that daemon is not a macOS session gateway: https://github.com/patrickjaja/claude-cowork-service/blob/main/COWORK_RPC_PROTOCOL.md

## Implementation

1. Restore only the useful local Cowork discovery/event formatting and adapter tests. Keep Code filtering and account/organization isolation.
2. Implement and test broker route validation before any keychain access: fixed API origin, no redirects, only locally associated Cowork session IDs, validated user-message payloads, no worker creation or registration, no credential-export command.
3. Compile/sign a stable helper outside the repository. Keep secrets in native memory, disable core dumps, use bounded responses and no credential logging. This does not require a native GUI app or DMG.
4. Implement a Node broker client with bounded requests, correlation IDs, account checks, lifecycle cleanup and conservative unknown-delivery behavior. Add provider discovery and the existing enable switch.
5. Test metadata/history against the installed Desktop and test one harmless reply only in a designated verification session. Check the same original session ID and returned user-message receipt. If the system requests keychain authorization, report that real gate explicitly.
6. Run tests/build/browser checks, document compatibility and the provider-network boundary, enable the integration locally, merge and push.

## Acceptance

- No Safe Storage master key or OAuth bearer is returned in broker output, logs, browser responses or repository artifacts.
- The broker refuses arbitrary URLs, non-Cowork IDs, cross-account scopes, worker lifecycle requests and malformed messages before submitting.
- Existing sessions appear under the correct current Desktop account; no duplicate executor or UI automation.
- Read and send evidence is reported separately; an installed helper is not proof of successful same-session reply.
- macOS permission and clean-machine acceptance are not represented as already passed without evidence.

## Completed verification

- Native restricted-route, post-message, redirect policy source review and synthetic v10 decoding self-tests passed; no keychain access needed for self-tests.
- 149 Node tests passed; production build passed. Chromium/WebKit synthetic mobile Cowork flows passed.
- Installed Desktop 2.9939.2: original Pokite signing identity/path reused, current account/organization verified, one project and four sessions readable.
- Original designated verification session received one no-tool request, one native user echo and the expected assistant reply; request receipt matched (about 19 seconds including reads). No replacement executor or UI input automation was used.
- The former key-export command was not restored. Its owned installation slot now contains the request-only broker and is protocol-version checked before use.
