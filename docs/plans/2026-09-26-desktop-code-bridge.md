# Desktop Code Remote Control integration

Goal: connect existing Desktop Code sessions through their own native Remote Control bridge, never resume them through the independent CLI adapter.

Diagnosis: shared user settings contained CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1. Removed that one flag with a private backup, preserving gateway credentials and other settings. A no-model-turn diagnostic process using Desktop's OAuth environment established a bridge. The existing idle Desktop Code backend was restarted, and a harmless initialization message caused Desktop to establish its original session bridge (ready/connected). The busy original session was not interrupted. Native UI interaction was used only for this one-time Desktop setup; no UI automation is part of Pokite transport.

Implementation: authorize bridge IDs only when associated with the current Desktop account/organization's Code metadata. Group them by the original workspace under Code projects. Read/reply through the existing broker protocol and existing queue receipts. Do not display independent CLI bridges or permit cloud-new-session creation under local Code workspaces. Disconnected local bridges remain visibly offline.

Validation: local account/organization ownership, unrelated CLI rejection, original thread history and one remote reply echoed in the original local transcript. A successful diagnostic process alone is not evidence for original Desktop session integration. No Desktop code/account modification, no new execution session for user work.

## Verified outcome

- Existing Desktop Code bridge entered ready and connected after the blocking flag was removed and the idle backend was reinitialized. Official OAuth scopes and provider were already valid. No mobile login was involved in bridge establishment.
- Native broker read one current-account Desktop Code project/session; unrelated CLI bridges were excluded.
- One no-tool message through the native bridge produced one user echo, matching receipt and assistant reply. The reply was independently found in the original local CLI transcript associated with that Desktop session.
- 166 Node tests and native broker self-tests passed; cloud mobile UI regressions passed in Chromium/WebKit.
- One-time native UI setup was used to retry the exited idle backend and start a harmless original-session turn. Pokite's runtime transport does not automate the UI. The other running Code backend was not stopped.

## Deployed acceptance

- The mobile web composer submitted one message through Pokite's normal queue to the original Desktop Code session. Exactly one user echo and the assistant reply appeared. Native Desktop accessibility inspection also confirmed the remote verification text is visible in its own UI.
- The second original Code session later became idle. Its backend was then reinitialized separately; it also reached ready/connected. No active task was terminated.
- Both original sessions now have native bridge associations and appear under their Code workspace. Existing cloud Chat/Cowork and independent CLI entry remain separate.
- The global settings backup is private local state. Only the nonessential-traffic flag was removed; gateway/account settings and Pokite's access code were preserved.
