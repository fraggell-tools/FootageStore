# FootageStore

## Project Overview
Internal footage management and AI-analysis system for Fraggell Productions. Ingests video files from Google Drive, extracts thumbnails with ffmpeg, generates AI descriptions via the Anthropic API, and stores everything in a searchable database for internal use.

**Live at:** https://footagestore.fraggell.com (via Cloudflare tunnel — check Zero Trust dashboard for exact routing)
**Repo:** https://github.com/frasercottrell/FootageStore (private)

## Tech Stack
- **Framework:** Next.js 16.1.6 + React 19 + TypeScript
- **Database:** PostgreSQL 16 via Drizzle ORM (not Prisma)
- **Queue:** Redis 7 + BullMQ for background jobs
- **Worker:** separate Node process (`worker/index.ts`) that consumes the queue, runs ffmpeg thumbnails, hits the Anthropic API, syncs Google Drive
- **Auth:** NextAuth.js with Google OAuth + credentials
- **Output:** Next.js standalone build
- **External APIs:** Anthropic (Claude), Google Drive

## Infrastructure
- **Host:** Unraid at `192.168.0.150`
- **Containers (all run together via docker-compose):**
  - `app` — Next.js server on port `3700:3700`
  - `worker` — background worker (no exposed port, consumes Redis queue)
  - `db` — postgres:16-alpine (in-compose, not the global `postgres16` container)
  - `redis` — redis:7-alpine (in-compose)
- **Appdata path:** `/mnt/user/appdata/footagestore/`
- **Volumes:**
  - `/mnt/user/appdata/footagestore/data:/data` (ingested media, thumbnails)
  - `/mnt/user/appdata/footagestore/postgres:/var/lib/postgresql/data` (Postgres data dir)
  - `/mnt/user/appdata/footagestore/redis:/data` (Redis persistence)
- **Source on server:** `/mnt/user/appdata/footagestore/app/` (this is the git checkout — note the `app/` subfolder)
- **Tunnel:** Cloudflare Zero Trust → `footagestore.fraggell.com` (verify in dashboard)
- **Unraid Docker tab:** compose-managed, no XML template required (handled via Compose Manager or shown as unmanaged — check the `dockerMan/templates-user/` folder for `my-footagestore.xml` if one exists)

## Database
- PostgreSQL 16, credentials in `docker-compose.yml`: user/password/db all = `footagestore`
- Managed via **Drizzle**, not Prisma. Schema lives under `src/lib/db/schema.ts` (or similar)
- Migrations via `drizzle-kit`:
  - `npm run db:generate` — generate from schema changes
  - `npm run db:migrate` — apply to DB
  - `npm run db:seed` — seed data
- Migrations should be committed to the repo. Run `db:migrate` inside the app container (`docker exec app-app-1 npm run db:migrate`) after deploys that include schema changes

## Docker Setup
- Two Dockerfiles: `Dockerfile` (app) and `Dockerfile.worker` (worker)
- The compose file builds both services from the same source tree (`context: .`)
- Third service `deploy-webhook/` subfolder has its own Dockerfile + compose — this is a separate mini-service that receives webhooks from GitHub Actions to trigger deploys on the Unraid. Check its README before touching.
- Worker and app share the `/data` volume so the worker can write ffmpeg thumbnails that the app then serves

## Deployment (Claude-driven)

### Pre-deploy safety checklist
1. **Is anyone else touching the server?** Check `docker ps -a` for recent temp containers, check mtimes under `/mnt/user/appdata/footagestore/`.
2. **Back up the Postgres database** BEFORE any deploy that includes a Drizzle migration:
   ```bash
   mkdir -p /mnt/user/backups/footagestore/$(date +%Y-%m-%d-%H%M)-pre-deploy
   docker exec app-db-1 pg_dump -U footagestore footagestore \
     > /mnt/user/backups/footagestore/$(date +%Y-%m-%d-%H%M)-pre-deploy/footagestore.sql
   ```
   (Adjust container name if it differs — `docker ps --format '{{.Names}}' | grep footagestore` to find the real name.)
3. **Review any new drizzle migrations** in the repo under the drizzle migrations folder before pulling. Destructive migrations (DROP COLUMN, ALTER TYPE) need extra care.

### Deploy steps
1. Commit + push to `main` locally (PR + merge flow).
2. SSH to Unraid.
3. `cd /mnt/user/appdata/footagestore/app`
4. `git pull origin main`
5. `docker compose up -d --build` — rebuilds both `app` and `worker`, restarts `db` + `redis` if their config changed
6. If there are new migrations: `docker exec app-app-1 npm run db:migrate` (use the actual container name)
7. Verify:
   - `docker logs app-app-1 --tail 30` — look for "Ready" / server started on port 3700
   - `docker logs app-worker-1 --tail 30` — look for worker connected to Redis + Postgres
   - `curl -s http://localhost:3700/ | head -5` — should return HTML, not an error

### Rollback
```bash
cd /mnt/user/appdata/footagestore/app
docker compose down
# restore DB:
docker compose up -d db
sleep 5
cat /mnt/user/backups/footagestore/<timestamp>-pre-deploy/footagestore.sql | docker exec -i app-db-1 psql -U footagestore footagestore
# restore code:
git reset --hard <previous-good-sha>
docker compose up -d --build
```

## Git Auth (server side)
- `origin` should use SSH: `git@github.com:frasercottrell/FootageStore.git`
- Auth via ed25519 deploy key at `/root/.ssh/id_ed25519`
- **Do NOT bake a PAT into the remote URL.** Exposed tokens have been a recurring problem — don't regress.

## Environment Variables
Lives at `/mnt/user/appdata/footagestore/app/.env` (or passed via compose environment, whichever pattern this repo uses). Required:
- `ANTHROPIC_API_KEY` — Claude API key for video analysis
- `OPENAI_API_KEY` — Whisper API key for audio transcription (worker only). If unset, transcription is skipped silently.
- `NEXTAUTH_SECRET` — session secret
- `NEXTAUTH_URL` — public URL
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` — Google Drive OAuth
- `GOOGLE_DRIVE_PARENT_FOLDER_ID` — where to scan for new media
- `DATABASE_URL=postgresql://footagestore:footagestore@db:5432/footagestore` (container-internal DNS)
- `REDIS_URL=redis://redis:6379`

## Unraid MCP Guardrails
- `rm` / `rm -rf` → blocked on host. Use `mv` to a trash folder, or `docker exec <container> rm` for files inside a container.
- `chmod` / `chown` → blocked on host. Use `docker exec` instead.
- Output redirects to `/dev/null` → blocked.
- Paths with `(` `)` → blocked in `read_file`; use `cat` via `run_command`.

## Network Notes
- Local Mac on `192.168.68.x`, Unraid on `192.168.0.x` — no direct SCP
- The `app` and `worker` containers talk to `db` and `redis` via compose's internal network (hostnames `db` and `redis`), not the Unraid host
- Cloudflare tunnel config is in the Zero Trust dashboard

## Key Files
- `src/app/` — Next.js routes
- `src/lib/db/` — Drizzle schema + migrations + queries
- `worker/index.ts` — worker entrypoint
- `worker/processors/` — individual BullMQ job handlers
- `worker/syncDrive.ts` — Google Drive sync logic
- `worker/reanalyze.ts` — re-run AI analysis on existing media
- `Dockerfile` / `Dockerfile.worker` — build configs
- `docker-compose.yml` — service topology (app + worker + db + redis)
- `deploy-webhook/` — subsystem that receives GH webhooks to trigger deploys (separate service)
- `drizzle.config.ts` — Drizzle kit config

## Backups
- Folder: `/mnt/user/backups/footagestore/YYYY-MM-DD-HHMM-<label>/`
- Postgres backups via `pg_dump`, NOT filesystem copies — the Postgres data dir is a live database and can't be safely `cp`'d
- Redis data is ephemeral (queue state); losing it means in-flight jobs retry, no permanent data loss
- The `/data` volume (media files) should be backed up separately if these files aren't also mirrored in Google Drive

## Incident History
- _(None yet — log entries here whenever something breaks and gets fixed, so future sessions don't regress the fix.)_
