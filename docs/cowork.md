# Claude Desktop: unified Chat / Cowork

Pokite reads the signed-in Desktop account's **cloud project catalog and unified
CSE sessions**. It no longer treats the local Cowork folder index as a complete
conversation list. The independent **Claude Code CLI** entry is separate;
Desktop Code is supported for existing local sessions whose own Remote Control bridge is connected.

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

The helper always uses `Application Support/Pokite/Cowork/Pokite Cowork Access`
and identifier `app.pokite.cowork-request-broker`. It does not inherit the old
key-export helper identity. Local ad-hoc signing is the default; a specific
certificate is used only when explicitly configured. A changed binary may need
fresh macOS permission. No native GUI app, DMG or notarization is required.
See [authorization migration and current fixes](2026-09-26-auth-broker-review.md).

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
catalog grants expire and are refreshed before use. Desktop Code sessions become eligible only when a bridge ID is also recorded
in the current Desktop account and organization’s local Code metadata. Independent
CLI bridges and other accounts remain excluded.

Native protocol v4 also permits creation in an existing cloud project and only
two settings controls: `set_model` and `apply_flag_settings` containing
`effortLevel`. Other flags, permission changes, worker registration, project
mutations and credential export remain unavailable. Model and effort values are
checked against the account's live model selector. The bootstrap response is
reduced to model information before it leaves the broker.

## New sessions and model settings

Use the existing project's new-session button and send the first instruction.
Creation and that instruction are submitted in one provider request, with a
stable message UUID. The durable operation ledger prevents a lost response from
automatically creating another session. New sessions use Claude's cloud execution;
local file/tool access still follows Claude's existing permission and device rules.

The model and effort menus use the account's available options. Selections apply
to the next sent message (or queued message when its turn arrives). For an existing
session, Pokite waits for setting-control acknowledgements before posting the
message. A failed/unconfirmed change leaves the text marked **Not sent**, with
withdraw/edit available. It does not silently send on the previous model.

Projects and models have longer scoped caches than live session metadata. Opening
a conversation reuses fresh list metadata and fetches the latest history first.
After writes, session state is invalidated without discarding the stable project
catalog. Identity checks are retained for cached reads and native requests.

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

### Creation, settings and loading validation

The deployed web flow created a session and initial message atomically, with a
matching native receipt. Replaying the HTTP request returned the same session.
Sonnet 4.6 / low and then Sonnet 5 / medium both produced replies in that session;
metadata readback confirmed the actual settings. 160 Node tests, native checks
and Chromium/WebKit interaction checks passed.

A local timing sample reduced first conversation load from ~790 ms to ~374 ms;
warm reads were ~8–17 ms. Cold project loading remained around 2 seconds.
Repeated session refreshes now reuse project metadata instead of fetching it
again. These are local samples, not a cross-network latency guarantee.

## Desktop Code (local execution)

Under the same Claude Desktop entry, local Code workspaces appear as **Code ·
workspace name** when an existing Desktop session has a connected Remote Control
bridge. Reading and replying target that bridge and original executor; Pokite
does not resume it through Claude Code CLI or simulate Desktop composer actions.
Desktop must remain running. Disconnected bridges are shown offline. New local
Code sessions and model controls remain in Desktop for this initial integration;
cloud Chat/Cowork creation and controls remain unchanged.

Remote Control needs official subscription authentication and feature evaluation.
A shared `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` setting prevents it. Removing
that flag can require reopening the Code backend; simply changing the file does
not rebuild an already initialized connection. Do not interrupt a running task.
The mobile app does not need to be logged in for Desktop to establish its bridge.
The bridge itself uses Anthropic's service, not an entirely local protocol.
