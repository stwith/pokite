# Claude Desktop: unified Chat / Cowork

Pokite reads the signed-in Desktop account's **cloud project catalog and unified
CSE sessions**. It no longer treats the local Cowork folder index as a complete
conversation list. The independent **Claude Code CLI** entry is separate;
Desktop Code attachment remains unsupported.

## Setup and identity

On macOS, install/update the request broker with Xcode Command Line Tools:

```sh
npm run setup:cowork
```

Enable **Claude Desktop** under Settings → Agent connections on localhost.
The broker uses the Desktop account and active organization; no Pokite account
or separate browser login is required. Open Desktop and its Chat/Cowork surface
if its cached session authorization needs refreshing. Pokite does not refresh,
replace or write Desktop login credentials itself.

The signed helper stays under Application Support. An existing Pokite helper is
upgraded in place with its signing identity so the owner's macOS permission can
be retained. New installations can use a local ad-hoc signature; no native GUI
app, Developer ID subscription, DMG or notarization is required. macOS may request
Claude Safe Storage permission on first use or after signing changes.

## Discovery and grouping

- Projects come from the authenticated cloud project API, including projects
  without a local folder record. Server names are preserved.
- Unified Chat/Cowork sessions come from the account/organization-scoped session
  catalog. Local `spaceId` and newer `folders` associations are supplemental.
- The cloud API's opaque project IDs are matched to the project catalog UUIDs;
  folder basenames are not used to guess cloud project names.
- Sessions without a project appear under **未分组**. Existing local project IDs
  are retained as aliases where possible for older notification links.
- Discovery reads metadata, not transcripts. Requests are coalesced and cached;
  warm lists refresh in the background. History is fetched only when opened.
- Session classification uses execution metadata and tags. A `cse_` ID, a
  `/v1/code/sessions` route or a `user:sessions:claude_code` OAuth scope does not
  mean the conversation belongs to the Desktop Code tab.

Current validation covers the unified CSE conversation model used by this
Desktop account. Older UUID-based legacy Chat completion APIs are not implemented
by this adapter. The account's legacy Chat collection was empty during validation.

## Credential and network boundary

Phone → LAN/Tailscale → Pokite → native request broker → Anthropic APIs.
Cloud execution and model calls remain on Anthropic's infrastructure. This is
not a purely local Claude protocol and adds no Pokite-operated relay.

Safe Storage keys, OAuth bearers and Desktop session cookies stay inside the
native process. The broker decrypts only its required Desktop credentials and
performs the requests itself; Node and the browser receive metadata and
conversation results, never those credentials.

The broker exposes no socket listener or arbitrary URL/header operation. It
allows fixed HTTPS hosts, read-only project catalog operations and validated
existing-session reads/replies. Redirects are refused. Web-cookie identity is
checked against the active Desktop account, organization paths are restricted,
and cloud session IDs must be established by an authenticated catalog. Short
catalog grants expire and are refreshed before use. Desktop Code sessions do not
become writable merely because they appear in the global session response.

Only a validated single user-message event may be posted. Worker registration,
execution-session replacement, project mutations and credential export remain
unavailable. Accepted-but-unconfirmed writes are not automatically resent.

This is a same-user integration, not protection against an attacker already
running arbitrary code as the Mac owner. Private upstream APIs and Desktop
storage formats remain version-sensitive. Tests without real credentials do
not establish live API compatibility.

## Validation

On 2026-09-26 with Desktop 2.9939.2, the native broker successfully read three
cloud projects and nine unified sessions. The reported project-associated
session and the two reported Chat sessions were all readable: the former mapped
to its real cloud project, the latter to the ungrouped list. No personal IDs or
conversation content are recorded in this document.

The deployed cloud adapter was tested through the actual mobile web composer
in the pre-existing designated verification session: one request, one user echo
and the expected original-session assistant reply. The three reported work
sessions were checked read-only. 154 Node tests, native broker checks, production
build and Chromium/WebKit synthetic mobile checks passed.
