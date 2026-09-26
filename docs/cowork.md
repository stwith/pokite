# Claude Desktop Cowork

> Scope correction (2026-09-26): this adapter currently covers only sessions
> present in Desktop's local project/session association files. It does not
> enumerate the account's complete cloud project or conversation catalog. The
> successful tests below prove those selected sessions, not complete Claude
> Desktop support. Chat/Cowork UI labels are not reliable protocol categories.

## Current product model and the missing catalog

Anthropic now documents a gradual Chat/Cowork convergence for Pro and Max;
Team/Enterprise may still retain separate experiences. Cowork runs in the cloud
by default; existing local deployments also remain possible. Desktop is a
client and local-tool bridge, not proof that a displayed session executes locally.

Sources:
- https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude
- https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview

Pokite's independent Claude Code entry uses the Claude Agent SDK and local CLI
history. It does not attach to Desktop Code, and a working CLI integration does
not establish Desktop Remote Control connectivity.

The current cloud adapter starts from `spaces.json` and
`remote-session-spaces.json`, then reads those IDs through the provider API.
A user-reported cloud project and two reported sessions were absent from both
local Cowork and Code metadata stores. The native broker's local-ID allowlist
also prevents accessing these missing sessions. Changing a display filter cannot
fix this; cloud catalog discovery is required. Session IDs alone do not determine
whether the UI calls a conversation Chat, Cowork or Code.

The next implementation must enumerate the signed-in account/organization's cloud
projects and sessions, use authoritative metadata for grouping and execution
capabilities, and authorize IDs from that verified catalog inside the native
broker. It must retain account isolation and the no-credential-export boundary.
The two reported cloud sessions have not yet been read or replied to by Pokite.
Personal project names and session identifiers are deliberately omitted here.


Pokite can follow the **existing Cowork projects and sessions associated with the
currently signed-in Claude Desktop account**. Desktop Code is not attached. Full unified Chat/Cowork cloud-catalog discovery
is not implemented; standalone Claude Code CLI remains a separate entry.

## Setup

On macOS with Xcode Command Line Tools installed:

```sh
npm run setup:cowork
```

The script compiles a small native request broker under the user's Application
Support directory and signs it locally. When upgrading an existing Pokite
keychain-helper installation, it retains that tool's path and signing identifier
to preserve the owner's prior macOS grant. The executable is replaced with the
request-only implementation; the old key-export interface is not restored. It reuses a matching installed binary
rather than rebuilding on every start. An available signing identity is reused;
otherwise a local ad-hoc signature is used. No native GUI app, Developer ID
subscription, notarization or DMG is required. Binary/signing changes may require
new macOS approval.

Enable **Claude Desktop · Cowork** under Settings → Agent connections on the
computer's localhost page. On first access, macOS may ask to access **Claude Safe
Storage**. Approve the request from **Pokite Cowork Access** (or **Pokite Claude Access**
for an in-place upgrade) on the Mac. If access
was denied, use the Cowork reconnect action to retry; polling does not repeatedly
request authorization. Keep Desktop signed in and its local session associations
available. Multiple ambiguous organizations fail explicitly instead of mixing
history.

## What is shared

Phone → LAN/Tailscale → Pokite → local native request broker → Anthropic's existing
session API. This is **not a purely local Cowork protocol**. It introduces no
Pokite-operated relay and does not create another executor, register a worker,
simulate UI actions or create substitute sessions. Existing reply receipts and
unknown-delivery protection are retained. New Cowork sessions, model switching,
and Desktop Code attachment are outside this integration.

## Credential boundary

The previous helper exported the Safe Storage master key. It remains removed.
The replacement performs credential decoding and authenticated requests inside
the native process. Node and the phone receive session data, never the master key
or OAuth token. The process has no network listener and accepts only bounded
stdio requests for profile validation, metadata/history of locally associated
Cowork IDs, and a strictly validated user message. The API host is fixed, redirects
are refused, identity is checked before and after requests, and no credential
export or arbitrary URL/header operation exists.

This is a same-user local integration, not a defense against an attacker already
able to execute arbitrary code as the Mac owner. It still depends on private
Desktop storage and upstream session APIs; version changes can require adapter
updates. The native unit/self-tests do not prove live upstream compatibility or
macOS authorization. Live read/reply acceptance must be recorded separately.

## Validation on 2026-09-26

Installed Claude Desktop: 2.9939.2. The upgraded helper reused the previous
Pokite system authorization. Opening Desktop let it refresh the missing
`user:sessions:claude_code` authorization itself; Pokite did not refresh or
replace Desktop login credentials.

- Current profile account and organization matched the locally associated scope.
- One Cowork project and four existing sessions were read successfully.
- The previous designated verification session was idle and writable. One
  no-tool verification message was submitted, exactly one user echo was read,
  the native receipt matched, and the expected assistant reply arrived. The
  end-to-end verification took about 19 seconds, including initial reads.
- Chromium and WebKit mobile layouts passed against synthetic conversation data.
- Native route/encryption self-tests require no keychain access.

This proves the tested installed version and account, not all Desktop versions
or a clean-Mac installation. Desktop Code remains excluded; this test does not establish complete unified Chat/Cowork coverage.

After deployment, the live Pokite API exposed the restored Cowork entry, one
project and four sessions. A second verification used the actual mobile web
composer and queue: exactly one browser submission, one user echo and the
expected assistant response in the original verification session. Both Codex
project endpoints remained available. The access code was not changed.

All 149 Node tests, native broker self-tests, production build and GitHub Checks
passed. The native broker's initial keychain check also passed without a manual
connect call after the existing system grant was reused.
