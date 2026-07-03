# Drive Import Tool — Design

**Date:** 2026-07-03
**Status:** Approved by Fraser (2026-07-03)

## Purpose

Let admins paste a link to an external Google Drive folder (shared with us, possibly view-only), browse its contents, select all or a subset of folders/files, and copy the selection into one of our client folders under the "Footage Storage" parent. The existing Drive sync then ingests the copied footage through the normal pipeline (thumbnail, sprite, transcription, AI analysis).

## Constraints & context

- The app authenticates to Drive as one fixed Google account (`GOOGLE_REFRESH_TOKEN` in env). External folders are accessible only if that account was granted access or the link is "anyone with the link".
- Footage files live in Drive only; FootageStore stores `gdrive://<fileId>` references plus derived artifacts on `/data`. The import must follow this pattern — no local persistence of footage.
- The periodic sync (`worker/syncDrive.ts`) recursively scans client folders under `GOOGLE_DRIVE_PARENT_FOLDER_ID`, so anything copied into a client folder (including nested subfolders) is ingested automatically.
- Prod Postgres has **no `__drizzle_migrations` table** (schema built with `drizzle-kit push`), so any migration must be idempotent (`CREATE TABLE IF NOT EXISTS`, etc.).

## Decisions

| Decision | Choice |
|---|---|
| Post-copy behavior | Full ingest via existing sync (destination is always a client folder under the synced parent) |
| Drive access model | App's existing account; no per-user OAuth |
| Destination | Dropdown of existing clients + "create new client" |
| Source folder structure | Preserved — subfolder tree recreated inside the client folder |
| Access control | Admin-only, page lives at `/admin/import` |
| Transfer mechanism | Server-side `drive.files.copy` (no bytes through the Unraid) |

### Why `files.copy` over download-then-reupload

Google performs the copy server-side, so multi-GB footage transfers in minutes with zero local bandwidth. The failure case — source owner enabled "viewers can't copy/download" (`copyRequiresWriterPermission`) — blocks the download alternative equally, so nothing is lost. Those failures are surfaced per-file.

## Architecture

### 1. Link resolution + browse API

- `POST /api/admin/import/browse` (admin-guarded like `api/sync/route.ts`).
- Accepts either a pasted Drive URL or a folder ID. Link parser handles `…/folders/<id>`, `…/open?id=<id>`, `…/drive/u/<n>/folders/<id>`, trailing `?usp=sharing` etc.
- Returns one folder level per call: `{ folders: [{id, name}], files: [{id, name, mimeType, size}] }` via `drive.files.list` with `'<id>' in parents`, `trashed=false`, `supportsAllDrives: true`, `includeItemsFromAllDrives: true`, paginated.
- Lazy per-level listing keeps huge trees responsive; the UI calls it again on folder expand.
- New helper functions live in `src/lib/gdrive.ts` alongside the existing ones (e.g. `parseDriveFolderLink`, `listFolderChildren(folderId)`).
- Inaccessible/invalid links return a 4xx with a message telling the user to share the folder with the app's account or enable link access.

### 2. UI — `/admin/import`

- New page under `src/app/(app)/admin/import/page.tsx`; link added to `adminItems` in `src/components/layout/Sidebar.tsx`.
- Flow: paste link → resolve (shows source folder name) → expandable checkbox tree (checking a folder implicitly selects all descendants; select-all toggle; per-file checkboxes; running total of selected file count/size for already-listed items) → destination client dropdown (from `/api/clients`, plus inline "new client" which reuses the existing client-creation API) → **Import selected**.
- After kickoff the page polls `GET /api/admin/import/[importId]` showing status, copied/total counts, and per-file errors — same polling style as `/api/sync/status`.
- Selection is sent as `{ folderIds: [...], fileIds: [...] }` — folders selected wholesale are expanded server-side (the client doesn't need to have listed their contents).

### 3. Import job (worker)

- New job name `import-drive` on the existing `clip-processing` queue; `worker/index.ts` dispatches by job name. Processor at `worker/processors/importDrive.ts`.
- New `imports` table (Drizzle, `src/lib/db/schema.ts`) so progress survives restarts:
  - `id` uuid PK, `clientId` FK, `sourceFolderId`, `sourceFolderName`, `selection` jsonb (`{folderIds: [], fileIds: []}` — the worker reads this, since the job payload is only `{importId}`), `status` enum (`pending` / `running` / `completed` / `completed_with_errors` / `error`), `totalFiles` int, `copiedFiles` int, `skippedFiles` int, `errors` jsonb (`[{fileName, path, message}]`), `createdBy` FK users, timestamps.
  - Idempotent migration SQL (`CREATE TABLE IF NOT EXISTS`, `DO $$ … CREATE TYPE IF NOT EXISTS` pattern) committed to `drizzle/`.
- Worker steps:
  1. Expand selection: recursively enumerate selected folders (videos and other files alike — copy exactly what was selected), building a copy plan of `(sourceFileId, relativePath)`.
  2. Recreate the needed subfolder tree under the client's Drive folder (reuse/lookup existing folders by name before creating).
  3. Copy file-by-file with `drive.files.copy` (`supportsAllDrives: true`), updating `copiedFiles` as it goes.
  4. **Skip** files whose name already exists in the destination folder (safe re-runs, no duplicates); count as `skippedFiles`.
  5. Retry with exponential backoff on 403 rate-limit / 429 responses; other per-file errors (notably `cannotCopyFile` from copy-disabled sources) are recorded in `errors` and the run continues.
  6. Finish as `completed` or `completed_with_errors`; a thrown top-level failure marks `error`.
- `POST /api/admin/import` creates the DB row and enqueues the job; job payload is just `{ importId }` (details read from the DB), `jobId: importId` for dedup.

### 4. Ingest handoff

On completion the processor invokes the Drive sync directly (same function the periodic sync uses, already in-process in the worker) so new clips appear immediately instead of waiting for the next periodic pass. The normal `process-clip` pipeline handles everything downstream.

## Error handling summary

| Failure | Behavior |
|---|---|
| Bad/unsupported link | Immediate 400 at paste time with parse guidance |
| No access to source folder | 4xx with "share with `<app account>` or enable link access" |
| Copy-disabled file (`cannotCopyFile`) | Recorded per-file, run continues, surfaced in UI report |
| Drive rate limits (403/429) | Exponential backoff retry within the job |
| Worker restart mid-import | `imports` row shows last progress; job re-run skips already-copied files by name |
| Storage quota exceeded | Per-file error recorded; run continues so the report shows full extent |

## Testing

- Unit tests: Drive link parsing (all URL variants + raw IDs), selection → copy-plan expansion (mocked Drive listing), destination-folder reuse logic, skip-existing logic.
- Manual verification against a real external shared folder (both "shared with account" and "anyone with link" cases), including a copy-disabled file to confirm the error path.

## Out of scope

- Per-user Google OAuth (folders shared with individual team members' accounts).
- Importing from non-Drive sources (Dropbox, WeTransfer, raw URLs).
- Editor (non-admin) access.
- Transfer-time transformation (transcoding, renaming).
