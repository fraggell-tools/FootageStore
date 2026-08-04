# Dropbox Import — Design

**Date:** 2026-08-04
**Status:** Approved (pending spec review)
**Builds on:** [2026-07-03-drive-import-design.md](2026-07-03-drive-import-design.md)

## Goal

Let users paste a Dropbox shared link into the existing `/import` page and copy selected files/folders into a client's Google Drive folder, exactly like the Drive import. Files land in Drive and are ingested by the normal sync — the ingestion pipeline does not change.

## Key architectural difference vs Drive import

The Drive importer does server-side Drive→Drive copies (no bytes move through us). Dropbox cannot copy into Google Drive, so the worker **streams each file: download from Dropbox → resumable upload into the client's Drive folder**. Bandwidth cost is on the Unraid server (down from Dropbox + up to Drive). Imports run unattended in the background queue, same as today.

## Auth / setup (one-time)

A Dropbox app on Fraggell's existing Dropbox account, using the offline (refresh token) flow. The account does not need to own the shared files — the API can browse and download any accessible shared link.

New worker env vars (in `.env` on the server, wired through `docker-compose.yml` for the **worker and app** — app needs them for browse):

- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`

If unset, Dropbox links are rejected at browse time with a clear "Dropbox import isn't configured" message; Drive import is unaffected.

## Dropbox client — `src/lib/dropbox.ts`

No SDK dependency; plain `fetch`. Exposes:

- `getDropboxAccessToken()` — `POST https://api.dropbox.com/oauth2/token` (`grant_type=refresh_token`), cached in-process until near expiry.
- `getSharedLinkMeta(url)` — `POST /2/sharing/get_shared_link_metadata` → `{ name, isFolder }`.
- `listSharedLinkFolder(url, path)` — `POST /2/files/list_folder` with `shared_link: { url }` and `path` relative to the link root (`""` = root), following `list_folder/continue` pagination. Returns `{ folders: {path, name}[], files: {path, name, size}[] }`.
- `downloadSharedLinkFile(url, path)` — `POST content.dropboxapi.com/2/sharing/get_shared_link_file` with `Dropbox-API-Arg: { url, path }` → readable stream + size.
- `parseDropboxLink(link)` — validates/normalizes `dropbox.com/scl/fo/…` (folder) and `/scl/fi/…` (file) links; strips `?dl=` params but preserves `rlkey`. Old-style `dropbox.com/sh/…` links are also accepted (same API calls work).
- `withDropboxRetry(fn)` — mirror of `worker/processors/driveRetry.ts`: retry on 429 (honouring `Retry-After`) and 5xx, bounded attempts.

**Identifiers:** files/folders inside a shared link are addressed by *path relative to the link root* (e.g. `/Subfolder/clip.mp4`), not by Dropbox file id — ids aren't reliably available through shared-link browsing. These paths go into `selection` as the `id` field.

## Data model

Reuse the `imports` table. One new column, idempotent migration (prod has no `__drizzle_migrations` — use `ADD COLUMN IF NOT EXISTS`):

- `source` — `varchar(20) not null default 'drive'`, values `'drive' | 'dropbox'`. (Plain varchar, not a pg enum, to keep the migration trivially idempotent.)

Column reuse for Dropbox rows:

- `source_folder_id` → the normalized shared link URL. **Widen from varchar(255) to text** in the same migration (`ALTER COLUMN … TYPE text` — idempotent) since links with `rlkey` can approach/exceed 255.
- `source_folder_name` → link's display name from `get_shared_link_metadata`.
- `selection.folders[].id` / `selection.files[].id` → relative paths within the link.

Everything else (status, totals, errors, createdBy) behaves identically, so the existing import-history UI works with no changes beyond an optional source badge.

## API changes

**`POST /api/import/browse`** — auto-detects link type:

- Drive link → existing behavior, unchanged.
- Dropbox link → `getSharedLinkMeta` + `listSharedLinkFolder(url, path ?? "")`. Response shape is the same `{ folder, folders, files }`; entry `id`s are relative paths. Subfolder expansion: the page sends `{ link, path }` (it already holds the pasted link in state) instead of `{ folderId }`.
- A single-file Dropbox link (`/scl/fi/…`) returns a one-file listing so the normal selection UI works.
- Friendly errors: revoked link / 404 → reuse the no-access pattern; `shared_link_access_denied` with password → "Ask the sender to remove the link password or reshare"; env vars missing → "Dropbox import isn't configured on the server".

**`POST /api/import`** — accepts `source: 'drive' | 'dropbox'` (default `'drive'`), stores it, and enqueues `import-dropbox` instead of `import-drive` when Dropbox. Validation otherwise identical.

## Worker — `worker/processors/importDropbox.ts`

Registered as the `import-dropbox` job. Structural twin of `importDrive.ts`:

1. Load import + client, guard client Drive folder exists, mark `running`.
2. Build the copy plan by **reusing `buildCopyPlan` from `importPlan.ts` unchanged** — it already takes a `listChildren(id)` callback. Pass an adapter closure over the shared link: `(path) => listSharedLinkFolder(url, path)` mapped to the `DriveFolderChildren` shape with `id` = relative path. `CopyPlanEntry.sourceFileId` therefore holds the Dropbox relative path.
3. For each entry, sequentially:
   - `ensureFolderPath` into the client's Drive folder (reuse the existing helper — extract it from `importDrive.ts` into a shared module rather than duplicating).
   - Existing-names dedupe: if a file with that name already exists in the destination folder → `skipped++` (same semantics as Drive import; safe re-run/resume).
   - Otherwise stream: `downloadSharedLinkFile` → `uploadFileToDrive(stream, name, destFolderId)` (new function in `src/lib/gdrive.ts`, resumable upload so multi-GB files survive; pass size when known).
4. Progress saved every 5 files; per-file failures appended to `errors` and the loop continues.
5. Final status `completed` / `completed_with_errors`; trigger `runDriveSync()` like the Drive import.

A failed/interrupted job re-run is safe: dedupe-by-name skips everything already uploaded. (BullMQ `jobId = importId` already prevents duplicate enqueues.)

**Partial-upload caveat:** if the worker dies mid-upload, Drive may hold a partial file that the re-run then skips by name. Accepted for v1 (matches the Drive importer's trust-by-name model); the errors list + import history make it visible.

## UI changes (`/import` page)

- Placeholder/help text mentions both link types.
- Page keeps the pasted link in state and sends `{ link, path }` for Dropbox subfolder expansion (it already re-hits browse for expansion).
- Optional: small "Dropbox" badge on the review/history rows via the new `source` field.
- No new tab, toggle, or route.

## Error handling summary

| Failure | Behavior |
| --- | --- |
| Env vars missing | Browse rejects Dropbox links with config message; nothing enqueued |
| Link revoked/invalid/password | Browse 4xx with actionable message |
| Refresh token invalid at job time | Import status `error`, message names the token |
| Per-file download/upload failure | Appended to `errors`, import continues, `completed_with_errors` |
| 429 / 5xx from either API | Retried with backoff (`withDropboxRetry` / existing `withDriveRetry`) |
| Worker restart mid-import | Job retries; dedupe-by-name resumes where it left off |

## Testing

Following the existing worker test pattern (`importPlan.test.ts`, `driveRetry.test.ts`):

- `parseDropboxLink` — `/scl/fo/`, `/scl/fi/`, legacy `/sh/`, `?dl=0/1` stripping, `rlkey` preservation, non-Dropbox rejection.
- Plan builder — nested folders, `list_folder/continue` pagination, files+folders mixed selection (mocked list function).
- `withDropboxRetry` — 429 with `Retry-After`, 5xx retry, non-retryable 4xx passthrough.
- No live-Dropbox integration tests.

## Deploy notes

- Idempotent migration applied via psql on the server (per deploy-gotchas memory: drizzle-kit is pruned from the prod image).
- Add the three `DROPBOX_*` vars to the server `.env` + compose env lists (committed to the repo's compose file — server-local compose edits get wiped by the deploy webhook).
- One-time: create the Dropbox app (scopes: `sharing.read`, `files.metadata.read`, `files.content.read`), run the offline OAuth flow once to mint the refresh token.

## Out of scope (v1)

- Password-protected shared links (Dropbox API supports `link_password`; add later if clients actually send these).
- Importing from a Dropbox *account's own* file tree (only shared links).
- Checksum/size verification of uploads beyond Drive's own resumable-upload integrity.
- WeTransfer or other sources (separate design if wanted).
