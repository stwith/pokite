# Chat Files and Newlines

## Scope

- Select multiple photos or files from the phone's system file picker.
- Upload to the Mac and add durable Markdown references to the existing draft.
- Keep the existing message queue, retry receipts, withdrawal, and original agent executor.
- Preview local files linked by the current chat, including paginated history.
- Enter and Shift+Enter insert newlines. Sending requires the Send button.
- The attachment control is a transparent 16px icon to the left of the textarea,
  with a stable 28x32px button footprint outside the model toolbar.

## Supported Previews

PNG, JPEG, GIF, WebP, PDF (page controls), Markdown, and common UTF-8 text/code,
JSON, CSV, logs, and configuration files. HTML and SVG display as source text,
never executable documents. Other files can be uploaded, but show an unsupported
preview state. HEIC, Office documents, archives, audio, and video are not rendered.

Uploads are local file references, not a separate upload to a model provider.
The original local agent reads them using its existing file tools and permissions.
Cloud-only projects without a local directory cannot accept these uploads.

## Boundaries

- Single upload and binary preview: 20 MiB maximum.
- Text preview: first 200,000 bytes, with a truncation notice.
- Storage: 200 uploads or 500 MiB maximum; uploaded originals remain available
  for agent reads and durable retries. Nothing is served as a public static file.
- Files are stored under the configured Pokite state directory's `uploads` folder,
  in unique directories, with private filesystem modes and scoped receipts.
- All file requests require the existing bearer credential and origin checks.
- Upload receipts bind agent, project, and (when present) session identities.
- Desktop previews require an actual Markdown link/image or inline-code path
  in the native session messages; a supplied path alone is not authorization.
- Preview reads reject symlinks, directories, credential files, and Pokite state
  files outside upload storage. File reads use a pinned regular-file descriptor.
- Image and PDF previews validate signatures. Text is escaped by React.
- PDF.js renders pages to bounded canvases with evaluation disabled. Its worker
  is loaded from this origin. No file bytes or credentials are sent to a CDN.
- There is no download button, and preview requests do not place credentials in URLs.

## Verification

`test/chat-files.test.mjs` covers reference parsing, authentication, upload limits,
scope isolation, durable storage, symlink/secret blocking, history references,
signature checks, unsupported formats, and text truncation.

`scripts/verify-chat-files.mjs` starts isolated HTTP fixtures and drives the built UI
with Chromium and WebKit at 320x720, 390x844, and 1280x900. It verifies upload-only and text
messages, durable drafts, actual Enter behavior, IME safety, queued file previews,
images, Markdown, escaped HTML, missing files, failed uploads, dialog bounds,
and PDF page changes with canvas-pixel assertions. It never sends real agent work.

Release checks: `npm test`, `npm run build`, `npm run verify`, `git diff --check`.
Deployment restarts only Pokite using its draining stop/start scripts.
