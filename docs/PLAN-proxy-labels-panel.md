# Build Plan — 480p Proxies, Bulk Download, Month/Angle Labels

Status: DRAFT (2026-07-07). Owner: Nick. Est: ~4 days of web/panel work.

## Goal

1. **Fast previews in the Premiere panel** — pre-generate a lightweight 480p proxy per clip, stored on Cloudflare R2, so editors scrub previews from the edge instead of streaming multi-GB originals through Google Drive + the tunnel.
2. **Bulk download in the panel** — editor multi-selects clips, picks a local folder, downloads the **originals** to disk (import into Premiere stays as-is, from Drive/local).
3. **Month + angle labels** — auto-derived from the Drive `Client > Month > Angle` folder structure, editable, filterable/searchable in **both** the web UI and the panel.

Scope decisions locked with Nick:
- Preview = **single 480p MP4** (faststart, progressive — no HLS ladder needed).
- Originals are **not** cached to R2 (would be ~3 TB / ~£37/mo; proxies are ~120 GB / ~£1.75/mo).
- Proxy/bulk-download features are **panel-only**; labels are panel **and** web.

## Ground truth (verified this session)

- Library: **22,281 ready clips, 198.6 h total, ~32 s avg, ~3 TB originals**. 480p proxy of the whole library ≈ **~120 GB on R2 (~£1.75/mo, zero egress)**.
- `clips` table stores only `gdrive://<fileId>` + filename — **no folder path captured**. Month/angle must be captured at sync time.
- `src/lib/gdrive.ts::listFilesInFolder` recurses via a flat stack and **discards the folder hierarchy** — needs to track path segments.
- Panel is a standard CEP panel, now extracted to `panel/` (byte-exact from the deployed zip). Update flow = `API_BASE` + `/panel-version.json` + `/api/panel/download`; bump `PANEL_VERSION` in `panel/js/main.js` and `public/panel-version.json` to ship.
- Fraggell Review already implements the proxy+R2 pipeline (`fraggell-review/src/lib/ffmpeg-proxy.ts`, `r2.ts`, `proxy-worker.ts`) — port the single-rung path, drop the HLS ladder.

---

## Phase 0 — Security cleanup (partly done)

- [x] **Rotated prod `NEXTAUTH_SECRET`** (was the placeholder `...change-me-later`). Done 2026-07-07.
- [ ] **Scrub server/test files from the panel bundle before committing `panel/`.** Remove `plugin_auth_server.js`, `plugin_auth_package.json`, `setpw.js`, `test_jwt.js`, `test/` — these are server/test artifacts that shipped a DB password + auth internals to editor laptops. Confirm `panel/js/main.js` doesn't `require` them (it auths against the Next route, not the standalone 3709 server).
- [ ] Set `PLUGIN_API_KEY` and `DB_PASSWORD` as real env vars on the server (currently unset → app uses fallbacks). Lower priority; plugin key is inherently client-side.
- [ ] Commit `panel/` (scrubbed) so it's version-controlled going forward.

---

## Phase 1 — Month/Angle labels (ship first; smallest, independent)

**Backend**
- `src/lib/db/schema.ts`: add `month varchar(50)`, `angle varchar(100)` to `clips`.
- Migration `000X_clip_month_angle.sql`: `ALTER TABLE clips ADD COLUMN IF NOT EXISTS ...` (idempotent — prod has no `__drizzle_migrations`, built via `drizzle-kit push`).
- `src/lib/gdrive.ts::listFilesInFolder`: push `{id, segments}` onto the scan stack; attach `relativePath: string[]` to each `DriveFile` (segments below the client root).
- `worker/syncDrive.ts`: on create **and** on existing clips where null, set `month = segments[0]`, `angle = segments[1]`. Existing 22k clips backfill naturally on the next 3-min sync once the update path is added (or run a one-off backfill).
- `PATCH /api/clips/[clipId]`: accept `month`, `angle` for manual override.

**Web UI**
- Clients page (`src/app/clients/[slug]/page.tsx`): add month + angle filter chips (reuse the existing tag/SKU multi-select pattern) and include them in the text-search term set.
- Clip detail modal: inline edit for month/angle (mirror the shot-type control).

**Panel**
- `panel/js/main.js`: show month/angle on clip cards; add month/angle filter controls; allow edit via the PATCH route.

---

## Phase 2 — 480p Proxy + R2 (backend)

**Infra**
- Create R2 bucket `footagestore-proxies`; add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` to `.env` + compose (app **and** worker).
- Bucket CORS: allow the panel + web origins (`*` acceptable for read of proxies).

**Code (port from fraggell-review)**
- `src/lib/r2.ts`: S3 client wrapper (`@aws-sdk/client-s3` + presigner). Copy from Review.
- `worker/processors/generateProxy.ts`: single 480p rung — `h264_nvenc` (≈1200k) with `libx264` fallback, AAC 96k, `+faststart`, thread-capped, `nice`. Output one MP4.
- Wire into `worker/processors/processClip.ts` after the sprite-sheet step.
- Upload proxy → R2 key `proxy/{driveFileId}.mp4`.
- Schema: `clips.proxyStatus` (`none|pending|processing|done|failed`), `clips.proxyR2Key`, `clips.proxyError`. Idempotent migration.
- `GET /api/clips/[clipId]/proxy`: auth, then 302 to a presigned R2 URL (or stream). Falls back to `/download` if no proxy yet.
- **Backfill:** enqueue proxy jobs for the existing 22k `ready` clips (batched, off-peak concurrency like Review's night mode).

---

## ⚠️ Panel batch — REQUIRED security fix (do with the panel work)

Automated review flagged a **CRITICAL XSS in `panel/js/main.js`** (pre-existing, came in with the extraction): clip cards + modal tags are built via `innerHTML` string concatenation with **unescaped** values from the API/Drive (`clip.name`, `originalFilename`, `shotType`, `tags`, `productSkus`, `code`, and now `month`/`angle` from Drive folder names). In a CEP panel (Node integration) XSS can escalate to RCE on the editor's machine. Adding month/angle display feeds Drive folder names straight into these same sinks, so this MUST be fixed as part of the panel batch:
- Add an `esc()` helper and wrap **every** untrusted interpolation (existing + new), or refactor `renderClipGrid`/`populateModalMeta`/`buildMenu`/`updateActiveTags`/drive-picker to `createElement` + `textContent`.
- Defense in depth: strip control chars + cap length on `month`/`angle`/`shotType` in the PATCH route server-side (length cap already done; add control-char strip).

## Validation status (2026-07-07)
- Branch `feat/month-angle-labels` pushed (5 commits). Local `tsc --noEmit` clean; server-side `docker compose build` of **both** app + worker images succeeded (isolated `fs_validate` project + worktree, prod containers untouched, artifacts cleaned up). Caught + fixed: missing package-lock for aws-sdk, and a strict-mode type error in the accent-colour map.
- **NOT merged to main.** Server `main` is at `e7cd555`, ahead of the branch base `f5d855b` — reconcile (rebase/merge) before deploy.
- R2 live: bucket `footagestore-proxies` created, review-app credentials (account-scoped, verified) in FootageStore `.env`.

## Phase 3 — Panel proxy preview

- `panel/js/main.js`: point the preview `<video>` at `API_BASE + /api/clips/{id}/proxy` (progressive MP4 — no hls.js). Keep original `/download` for import.
- Graceful fallback to `/download` when `proxyStatus !== 'done'`.

---

## Phase 4 — Panel bulk download

- `panel/js/main.js` (+ `host/index.jsx` if needed): multi-select mode on the clip grid.
- Native folder picker via CEP (`window.cep.fs` / ExtendScript `Folder.selectDialog`) — works on Mac + Windows, no browser File-System-Access limitation.
- Download each selected clip's **original** via existing `/api/clips/{id}/download` (with session token), stream to the chosen folder with Node `fs`. Small concurrency limit + progress UI.

---

## Panel build & deploy (modernise)

The existing `panel/build-and-deploy.bat` is Windows-only, hardcodes `ssh root@…`/`scp` (flaky from the Mac), uses retired `--no-cache`, and expects a `fraggell-footage-panel/` subfolder that doesn't match the flat zip. Replace with a Mac-friendly flow:

1. Bump version in `panel/js/main.js` (`PANEL_VERSION`) **and** `public/panel-version.json` (fix the current 1.6.0↔1.7.0 drift).
2. Zip `panel/` contents **flat** (files at zip root), excluding scrubbed server/test files.
3. Drop at `/data/panel/panel.zip` on the server (via unraid-ssh MCP, base64 transfer — no SCP).
4. Redeploy app (compose-build flow) so `panel-version.json` serves.
5. Editors see the update badge → install → restart Premiere.

---

## Rollout order & safety

1. Phase 0 scrub + commit → Phase 1 (labels, low risk, immediate value).
2. Phase 2 (proxy+R2) behind the backfill; verify a handful before the full 22k run.
3. Phases 3–4 in one panel version bump.
- **pg_dump backup before every migration** (per CLAUDE.md checklist).
- All migrations idempotent (prod uses `drizzle-kit push`, no migrations table).
- Client footage is irreplaceable — proxy jobs only ever **read** originals.
