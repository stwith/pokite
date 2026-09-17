# README visual assets

`mobile-session.png` is the real Pokite interface rendered with entirely
synthetic project, session, message, and timestamp fixtures. It is an illustrative
conversation, not evidence of a real task or performance benchmark.

Regenerate from the repository root:

```sh
npm run build
node scripts/capture-readme-demo.mjs
```

The script serves the production build on a temporary loopback port and
intercepts all API requests. It does not read `.local`, use real credentials,
contact an Agent, or capture a native desktop window. No access QR code is shown.
