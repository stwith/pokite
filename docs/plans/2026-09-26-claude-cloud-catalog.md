# Unified Claude Cloud Catalog Implementation Plan

**Goal:** Discover and use the current account's Desktop-visible Chat/Cowork cloud projects and sessions, including ones absent from the legacy local index. Keep the independent CLI and unconnected Desktop Code separate.

**Architecture:** Extend the request-only native broker with narrowly validated, read-only catalog operations. Authorize cloud session IDs from authenticated account-scoped discovery; never copy them into the Desktop's files to bypass the broker. Use cloud project metadata for grouping and preserve local folder associations as supplemental data. Existing CSE events/receipts remain the write transport where supported by the real upstream session. Unsupported formats fail explicitly.

**Tech Stack:** Existing Swift broker, Node adapter/caches, React session browser and existing tests.

1. Verify the user-specified session and inspect current association schema without printing conversation content or credentials.
2. Verify cloud catalog endpoints, auth scopes, paging and project/session response shape using read-only requests. Preserve fixed hosts, account checks and redirect rejection.
3. Add broker authorization tests for collection routes, session catalog membership, cross-account IDs and writes.
4. Replace local-only enumeration with bounded cached cloud discovery and real project grouping. Do not classify by tab text or cse_ prefix alone.
5. Verify all reported sessions and project membership through the API/UI. Test replies in the existing designated verification session, not arbitrarily in user work.
6. Update support documentation; build/test, deploy without changing the access code or restarting Desktop, push and clean the temporary worktree.

## Verified findings and implementation

- The reported project session was already in the newer local association schema, but used `folders` instead of `spaceId`. Its authoritative execution mode is `anthropic_cloud` and it has a cloud project ID.
- The two reported Chat sessions use the same CSE event protocol and cloud execution metadata, without project associations. They are included in the authenticated cloud catalog.
- `/projects_v2` returns project names/UUIDs with offset pagination. The session API uses the corresponding versioned base58 project ID. Both real project mappings were verified; folder names are not guessed.
- Cloud project API requests use the active Desktop web session inside the native broker, with account verification and a fixed host. CSE requests use scoped OAuth inside the same broker. Neither credential is exported.
- Organization selection uses Desktop's active-organization cookie, with account/API verification. Local session files are optional supplemental aliases, not catalog or identity authority.
- Native protocol v2 restricts project routes and session grants, refreshes catalog membership on restart/expiry, rejects cross-organization and Desktop Code grants, and refuses redirects and arbitrary operations.
- The old local-only reader was removed. Shared metadata caching keeps listing separate from transcript loading; old project IDs can resolve as aliases for notification links.
- 154 tests passed, native broker self-tests passed, production build passed, and Chromium/WebKit synthetic mobile UI checks passed.
- Live read checks: 3 cloud projects, 9 unified sessions; the reported project session maps to its cloud project, the two reported Chat sessions appear ungrouped. Personal names/IDs are not stored in this plan.
