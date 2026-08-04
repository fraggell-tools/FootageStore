# Dropbox Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a Dropbox shared link into the existing `/import` page and copy selected files/folders into a client's Google Drive folder (worker streams Dropbox → Drive), where the normal sync ingests them.

**Architecture:** A fetch-based Dropbox client (`src/lib/dropbox.ts`, no SDK) browses shared links via `files/list_folder` + `shared_link` and downloads via `sharing/get_shared_link_file`. The browse API auto-detects link type and returns the same tree shape. A new `import-dropbox` BullMQ job mirrors `importDrive.ts`, reusing `buildCopyPlan`, the folder/dedupe helpers (extracted to a shared module), and the existing `uploadFileToDrive` resumable upload.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle/Postgres, BullMQ, vitest, Dropbox HTTP API v2, googleapis (already present).

**Spec:** `docs/superpowers/specs/2026-08-04-dropbox-import-design.md`

## Global Constraints

- Branch: `feat/dropbox-import` (already created; spec committed on it).
- Migrations MUST be idempotent (`ADD COLUMN IF NOT EXISTS`, `SET DATA TYPE`) — prod has no `__drizzle_migrations` table; applied via psql, never `npm run db:migrate` on prod.
- No new npm dependencies. Dropbox via `fetch`; uploads via existing `uploadFileToDrive` in `src/lib/gdrive.ts`.
- Dropbox entries are addressed by **path relative to the shared-link root** (e.g. `/Sub/clip.mp4`); these paths go in `selection[].id` and `CopyPlanEntry.sourceFileId`. Root = `""`.
- For Dropbox imports, `imports.source_folder_id` stores the normalized shared-link URL.
- New env vars: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN` — needed by **both** app (browse) and worker (import). If unset, Dropbox links are rejected at browse time with "Dropbox import isn't configured on the server."; Drive import unaffected.
- Upload mimeType is `application/octet-stream` — `src/lib/isVideoFile.ts` already falls back to extension for generic mimes, so ingestion works.
- Tests: vitest (`npm test`). Typecheck: `npx tsc --noEmit`. Commit after each task.

---

### Task 1: Dropbox link parser

**Files:**
- Create: `src/lib/dropboxLink.ts`
- Test: `src/lib/dropboxLink.test.ts`

**Interfaces:**
- Produces: `parseDropboxLink(input: string): ParsedDropboxLink | null` where `ParsedDropboxLink = { url: string; kind: "folder" | "file" }`. `url` is normalized (https, `dl`/`st` params stripped, `rlkey` preserved). Used by Task 6 (browse route).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/dropboxLink.test.ts
import { describe, it, expect } from "vitest";
import { parseDropboxLink } from "./dropboxLink";

describe("parseDropboxLink", () => {
  it("parses a modern shared folder link and strips dl/st", () => {
    const r = parseDropboxLink(
      "https://www.dropbox.com/scl/fo/abc123xyz/AABBcc?rlkey=k9m2&st=xyz&dl=0"
    );
    expect(r).toEqual({
      url: "https://www.dropbox.com/scl/fo/abc123xyz/AABBcc?rlkey=k9m2",
      kind: "folder",
    });
  });

  it("parses a modern shared file link", () => {
    const r = parseDropboxLink("https://www.dropbox.com/scl/fi/def456/clip.mp4?rlkey=r1&dl=1");
    expect(r).toEqual({
      url: "https://www.dropbox.com/scl/fi/def456/clip.mp4?rlkey=r1",
      kind: "file",
    });
  });

  it("parses legacy /sh/ folder and /s/ file links", () => {
    expect(parseDropboxLink("https://www.dropbox.com/sh/abc/AACkey?dl=0")?.kind).toBe("folder");
    expect(parseDropboxLink("https://www.dropbox.com/s/abc/file.mov")?.kind).toBe("file");
  });

  it("accepts bare dropbox.com host and forces https", () => {
    const r = parseDropboxLink("http://dropbox.com/scl/fo/abc/AAB?rlkey=k");
    expect(r?.url).toBe("https://dropbox.com/scl/fo/abc/AAB?rlkey=k");
  });

  it("rejects non-Dropbox and garbage input", () => {
    expect(parseDropboxLink("https://drive.google.com/drive/folders/abc123def456")).toBeNull();
    expect(parseDropboxLink("not a url")).toBeNull();
    expect(parseDropboxLink("")).toBeNull();
    expect(parseDropboxLink("https://evil.com/scl/fo/abc")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/dropboxLink.test.ts`
Expected: FAIL — cannot resolve `./dropboxLink`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/dropboxLink.ts
/**
 * Parse a Dropbox shared link. Supported forms:
 *   https://www.dropbox.com/scl/fo/…?rlkey=…   (folder)
 *   https://www.dropbox.com/scl/fi/…?rlkey=…   (file)
 *   https://www.dropbox.com/sh/…               (legacy folder)
 *   https://www.dropbox.com/s/…                (legacy file)
 * Returns a normalized https URL with view-only params (dl, st) stripped —
 * rlkey is part of the link's identity and is preserved.
 */
export interface ParsedDropboxLink {
  url: string;
  kind: "folder" | "file";
}

export function parseDropboxLink(input: string): ParsedDropboxLink | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/(^|\.)dropbox\.com$/.test(url.hostname)) return null;

  let kind: "folder" | "file";
  if (url.pathname.startsWith("/scl/fo/") || url.pathname.startsWith("/sh/")) kind = "folder";
  else if (url.pathname.startsWith("/scl/fi/") || url.pathname.startsWith("/s/")) kind = "file";
  else return null;

  url.protocol = "https:";
  url.searchParams.delete("dl");
  url.searchParams.delete("st");
  url.hash = "";
  return { url: url.toString(), kind };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/dropboxLink.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/dropboxLink.ts src/lib/dropboxLink.test.ts
git commit -m "feat: Dropbox shared-link parser"
```

---

### Task 2: Dropbox API client with retry

**Files:**
- Create: `src/lib/dropbox.ts`
- Test: `src/lib/dropbox.test.ts`

**Interfaces:**
- Consumes: `DriveFolderChildren` type from `src/lib/gdrive.ts` (shape: `{ folders: {id,name}[]; files: {id,name,mimeType,size}[] }`).
- Produces (used by Tasks 5–7):
  - `isDropboxConfigured(): boolean`
  - `getSharedLinkMeta(url: string): Promise<{ name: string; isFolder: boolean; size: number }>`
  - `listSharedLinkFolder(url: string, path: string): Promise<DriveFolderChildren>` — entry `id`s are relative paths (`${path}/${name}`); paginated internally.
  - `downloadSharedLinkFile(url: string, path: string): Promise<{ stream: Readable; size: number }>` — pass `path: ""` for single-file links.
  - `withDropboxRetry<T>(fn, opts?): Promise<T>` — retries 429 (honours Retry-After) and 5xx; same option shape as `withDriveRetry`.
  - `DropboxApiError` — `Error` subclass with `.status: number` and `.summary: string` (Dropbox `error_summary`, e.g. `"shared_link_access_denied/.."`).

- [ ] **Step 1: Write the failing tests** (retry behaviour + pagination, with mocked fetch)

```ts
// src/lib/dropbox.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withDropboxRetry, DropboxApiError, listSharedLinkFolder } from "./dropbox";

const noSleep = () => Promise.resolve();

describe("withDropboxRetry", () => {
  it("retries 429 then succeeds", async () => {
    let calls = 0;
    const result = await withDropboxRetry(
      async () => {
        calls++;
        if (calls < 3) throw new DropboxApiError(429, "too_many_requests/..", 0);
        return "ok";
      },
      { sleep: noSleep }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("honours Retry-After from a 429", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await withDropboxRetry(
      async () => {
        calls++;
        if (calls === 1) throw new DropboxApiError(429, "too_many_requests/..", 7);
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms) }
    );
    expect(sleeps[0]).toBeGreaterThanOrEqual(7000);
  });

  it("retries 5xx", async () => {
    let calls = 0;
    await withDropboxRetry(
      async () => {
        calls++;
        if (calls === 1) throw new DropboxApiError(503, "", 0);
        return "ok";
      },
      { sleep: noSleep }
    );
    expect(calls).toBe(2);
  });

  it("does not retry 409 (link errors) and rethrows after max retries", async () => {
    let calls = 0;
    await expect(
      withDropboxRetry(
        async () => {
          calls++;
          throw new DropboxApiError(409, "shared_link_not_found/", 0);
        },
        { sleep: noSleep }
      )
    ).rejects.toThrow(DropboxApiError);
    expect(calls).toBe(1);

    await expect(
      withDropboxRetry(
        async () => {
          throw new DropboxApiError(429, "", 0);
        },
        { retries: 2, sleep: noSleep }
      )
    ).rejects.toThrow();
  });
});

describe("listSharedLinkFolder", () => {
  const LINK = "https://www.dropbox.com/scl/fo/abc/AAB?rlkey=k";

  beforeEach(() => {
    process.env.DROPBOX_APP_KEY = "k";
    process.env.DROPBOX_APP_SECRET = "s";
    process.env.DROPBOX_REFRESH_TOKEN = "r";
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(pages: object[]) {
    let page = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes("oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "t", expires_in: 14400 }));
        }
        return new Response(JSON.stringify(pages[page++]));
      })
    );
  }

  it("maps entries to DriveFolderChildren with relative-path ids, following pagination", async () => {
    stubFetch([
      {
        entries: [
          { ".tag": "folder", name: "Day 1" },
          { ".tag": "file", name: "a.mp4", size: 5 },
        ],
        has_more: true,
        cursor: "c1",
      },
      {
        entries: [{ ".tag": "file", name: "b.mov", size: 9 }],
        has_more: false,
      },
    ]);
    const r = await listSharedLinkFolder(LINK, "");
    expect(r.folders).toEqual([{ id: "/Day 1", name: "Day 1" }]);
    expect(r.files).toContainEqual({
      id: "/a.mp4", name: "a.mp4", mimeType: "application/octet-stream", size: 5,
    });
    expect(r.files).toContainEqual({
      id: "/b.mov", name: "b.mov", mimeType: "application/octet-stream", size: 9,
    });
  });

  it("prefixes subfolder paths", async () => {
    stubFetch([
      { entries: [{ ".tag": "file", name: "c.mp4", size: 1 }], has_more: false },
    ]);
    const r = await listSharedLinkFolder(LINK, "/Day 1");
    expect(r.files[0].id).toBe("/Day 1/c.mp4");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/dropbox.test.ts`
Expected: FAIL — cannot resolve `./dropbox`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/dropbox.ts
/**
 * Minimal Dropbox API v2 client for browsing + downloading shared links.
 * No SDK — three endpoints via fetch, authed by a refresh-token app on the
 * Fraggell Dropbox account. The account does not need to own the linked files.
 */
import { Readable } from "stream";
import type { DriveFolderChildren } from "./gdrive";

export class DropboxApiError extends Error {
  constructor(
    public status: number,
    public summary: string,
    public retryAfterSec: number
  ) {
    super(`Dropbox API error ${status}${summary ? `: ${summary}` : ""}`);
    this.name = "DropboxApiError";
  }
}

export function isDropboxConfigured(): boolean {
  return Boolean(
    process.env.DROPBOX_APP_KEY &&
      process.env.DROPBOX_APP_SECRET &&
      process.env.DROPBOX_REFRESH_TOKEN
  );
}

/* ── Access token (cached until near expiry) ─────────────────── */

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN!,
      client_id: process.env.DROPBOX_APP_KEY!,
      client_secret: process.env.DROPBOX_APP_SECRET!,
    }),
  });
  if (!res.ok) {
    throw new DropboxApiError(res.status, "invalid_refresh_token", 0);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

/* ── RPC helper ──────────────────────────────────────────────── */

async function rpc<T>(endpoint: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "0", 10);
    let summary = "";
    try {
      summary = ((await res.json()) as { error_summary?: string }).error_summary || "";
    } catch {
      /* non-JSON error body */
    }
    throw new DropboxApiError(res.status, summary, retryAfter);
  }
  return (await res.json()) as T;
}

/* ── Retry (mirror of worker/processors/driveRetry.ts) ───────── */

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isRetryableDropboxError(err: unknown): boolean {
  return err instanceof DropboxApiError && (err.status === 429 || err.status >= 500);
}

export async function withDropboxRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<T> {
  const { retries = 5, baseDelayMs = 2000, sleep = defaultSleep } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableDropboxError(err) || attempt >= retries) throw err;
      const retryAfterMs = (err as DropboxApiError).retryAfterSec * 1000;
      const backoff = baseDelayMs * 2 ** attempt + Math.random() * 1000;
      await sleep(Math.max(retryAfterMs, backoff));
      attempt++;
    }
  }
}

/* ── Shared-link operations ──────────────────────────────────── */

export async function getSharedLinkMeta(
  url: string
): Promise<{ name: string; isFolder: boolean; size: number }> {
  const meta = await rpc<{ ".tag": "folder" | "file"; name: string; size?: number }>(
    "sharing/get_shared_link_metadata",
    { url }
  );
  return { name: meta.name, isFolder: meta[".tag"] === "folder", size: meta.size ?? 0 };
}

/**
 * List one level of a shared folder link. `path` is relative to the link
 * root ("" = root, "/Sub" = subfolder). Entry ids are relative paths so
 * they can be fed back in as `path` (folders) or download paths (files).
 */
export async function listSharedLinkFolder(
  url: string,
  path: string
): Promise<DriveFolderChildren> {
  const folders: DriveFolderChildren["folders"] = [];
  const files: DriveFolderChildren["files"] = [];

  type Entry = { ".tag": "folder" | "file"; name: string; size?: number };
  type Page = { entries: Entry[]; has_more: boolean; cursor?: string };

  let page = await rpc<Page>("files/list_folder", { path, shared_link: { url } });
  for (;;) {
    for (const e of page.entries) {
      const id = `${path}/${e.name}`;
      if (e[".tag"] === "folder") folders.push({ id, name: e.name });
      else
        files.push({
          id,
          name: e.name,
          mimeType: "application/octet-stream",
          size: e.size ?? 0,
        });
    }
    if (!page.has_more) break;
    page = await rpc<Page>("files/list_folder/continue", { cursor: page.cursor });
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { folders, files };
}

/**
 * Download a file from within a shared link as a Node Readable stream.
 * Pass path "" for a single-file (/scl/fi/) link.
 */
export async function downloadSharedLinkFile(
  url: string,
  path: string
): Promise<{ stream: Readable; size: number }> {
  const token = await getAccessToken();
  const arg: { url: string; path?: string } = { url };
  if (path) arg.path = path;
  const res = await fetch("https://content.dropboxapi.com/2/sharing/get_shared_link_file", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify(arg),
    },
  });
  if (!res.ok || !res.body) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "0", 10);
    let summary = "";
    try {
      summary = ((await res.json()) as { error_summary?: string }).error_summary || "";
    } catch {
      /* non-JSON error body */
    }
    throw new DropboxApiError(res.status, summary, retryAfter);
  }
  let size = 0;
  try {
    const metaHeader = res.headers.get("dropbox-api-result");
    if (metaHeader) size = (JSON.parse(metaHeader) as { size?: number }).size ?? 0;
  } catch {
    /* size is best-effort */
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { stream: Readable.fromWeb(res.body as any), size };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dropbox.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Full test suite + typecheck, then commit**

Run: `npm test && npx tsc --noEmit`
Expected: all green

```bash
git add src/lib/dropbox.ts src/lib/dropbox.test.ts
git commit -m "feat: fetch-based Dropbox shared-link client with retry"
```

---

### Task 3: Schema + idempotent migration (`source` column, widen `source_folder_id`)

**Files:**
- Modify: `src/lib/db/schema.ts` (the `imports` table, ~line 122)
- Create: `drizzle/0005_imports_dropbox_source.sql`

**Interfaces:**
- Produces: `imports.source` column, TypeScript type `"drive" | "dropbox"`, default `'drive'`; `imports.sourceFolderId` becomes `text`. Tasks 5–7 read/write `source`.

- [ ] **Step 1: Update the schema**

In `src/lib/db/schema.ts`, change the `imports` table:

```ts
// change this line:
  sourceFolderId: varchar("source_folder_id", { length: 255 }).notNull(),
// to:
  sourceFolderId: text("source_folder_id").notNull(),
```

and add after the `selection` column:

```ts
  source: varchar("source", { length: 20 }).$type<"drive" | "dropbox">().notNull().default("drive"),
```

(`text` is already imported in this file — verify; if not, add it to the `drizzle-orm/pg-core` import.)

- [ ] **Step 2: Write the migration** (hand-written like `0001`/`0002`, NOT via drizzle-kit generate — prod is push-originated)

```sql
-- drizzle/0005_imports_dropbox_source.sql
-- Dropbox import: imports get a source discriminator, and source_folder_id
-- becomes text because Dropbox shared links (with rlkey) can exceed 255 chars.
-- Like 0000-0004 this runs against a push-originated database with no
-- __drizzle_migrations table, so every statement is idempotent.

ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'drive' NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ALTER COLUMN "source_folder_id" SET DATA TYPE text;
```

- [ ] **Step 3: Verify against local dev DB if one is running; otherwise typecheck only**

Run: `npx tsc --noEmit`
Expected: clean. (Migration itself is applied on the server at deploy time via psql — see Task 8.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0005_imports_dropbox_source.sql
git commit -m "feat: imports.source column + text source_folder_id (idempotent migration)"
```

---

### Task 4: Extract shared import helpers from `importDrive.ts`

**Files:**
- Create: `worker/processors/importShared.ts`
- Modify: `worker/processors/importDrive.ts` (remove the two local helpers, import them instead)

**Interfaces:**
- Produces (consumed by Task 5 and by `importDrive.ts`):
  - `ensureFolderPath(clientFolderId: string, relativePath: string[], cache: Map<string, string>): Promise<string>`
  - `getExistingNames(folderId: string, cache: Map<string, Set<string>>): Promise<Set<string>>`

Signatures and bodies move **verbatim** from `importDrive.ts:19-55` (they already wrap Drive calls in `withDriveRetry`). This is a pure move refactor.

- [ ] **Step 1: Create `worker/processors/importShared.ts`** — move the two functions plus their imports:

```ts
/**
 * Helpers shared by the Drive and Dropbox importers: destination folder
 * resolution and existing-file dedupe inside the client's Drive folder.
 */
import {
  listFolderChildren,
  findChildFolderByName,
  createFolder,
} from "../../src/lib/gdrive";
import { withDriveRetry } from "./driveRetry";

/** Resolve (find or create) the destination folder for a relative path, cached. */
export async function ensureFolderPath(
  clientFolderId: string,
  relativePath: string[],
  cache: Map<string, string>
): Promise<string> {
  let parentId = clientFolderId;
  let key = "";
  for (const name of relativePath) {
    key = key ? `${key}/${name}` : name;
    const cached = cache.get(key);
    if (cached) {
      parentId = cached;
      continue;
    }
    let folderId = await withDriveRetry(() => findChildFolderByName(parentId, name));
    if (!folderId) {
      folderId = await withDriveRetry(() => createFolder(parentId, name));
      console.log(`[Import] Created folder: ${key}`);
    }
    cache.set(key, folderId);
    parentId = folderId;
  }
  return parentId;
}

/** Names of files already in a destination folder, cached per folder. */
export async function getExistingNames(
  folderId: string,
  cache: Map<string, Set<string>>
): Promise<Set<string>> {
  const cached = cache.get(folderId);
  if (cached) return cached;
  const children = await withDriveRetry(() => listFolderChildren(folderId));
  const names = new Set(children.files.map((f) => f.name));
  cache.set(folderId, names);
  return names;
}
```

- [ ] **Step 2: Update `importDrive.ts`** — delete its local `ensureFolderPath`/`getExistingNames` definitions, add `import { ensureFolderPath, getExistingNames } from "./importShared";`, and drop the now-unused `findChildFolderByName`/`createFolder` names from its gdrive import (keep `listFolderChildren` and `copyDriveFile` — still used).

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: all green (pure move; existing `importPlan`/`driveRetry` tests unaffected)

- [ ] **Step 4: Commit**

```bash
git add worker/processors/importShared.ts worker/processors/importDrive.ts
git commit -m "refactor: extract shared import folder/dedupe helpers"
```

---

### Task 5: `importDropbox` worker processor + job registration

**Files:**
- Create: `worker/processors/importDropbox.ts`
- Modify: `worker/index.ts` (add job branch)

**Interfaces:**
- Consumes: `buildCopyPlan` (importPlan.ts), `ensureFolderPath`/`getExistingNames` (Task 4), `listSharedLinkFolder`/`downloadSharedLinkFile`/`withDropboxRetry`/`isDropboxConfigured`/`DropboxApiError` (Task 2), `uploadFileToDrive(folderId, fileName, mimeType, fileStream)` from `src/lib/gdrive.ts` (already exists).
- Produces: `importDropbox(data: { importId: string }): Promise<void>`, registered under BullMQ job name `"import-dropbox"`. Task 7's API enqueues that name.

- [ ] **Step 1: Write `worker/processors/importDropbox.ts`**

```ts
/**
 * import-dropbox job: stream a selection of files/folders from a Dropbox
 * shared link into a client's Google Drive folder (download → resumable
 * upload), preserving structure, then trigger a Drive sync. Mirrors
 * importDrive.ts; differs only in source listing and byte transfer.
 */
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { clients, imports, type ImportError } from "../../src/lib/db/schema";
import { uploadFileToDrive } from "../../src/lib/gdrive";
import {
  isDropboxConfigured,
  listSharedLinkFolder,
  downloadSharedLinkFile,
  withDropboxRetry,
  DropboxApiError,
} from "../../src/lib/dropbox";
import { buildCopyPlan } from "./importPlan";
import { ensureFolderPath, getExistingNames } from "./importShared";

function friendlyDropboxMessage(err: unknown): string {
  if (err instanceof DropboxApiError) {
    if (err.summary.startsWith("shared_link_access_denied"))
      return "Dropbox link requires a password or higher access — ask the sender to reshare without a password";
    if (err.summary.startsWith("shared_link_not_found"))
      return "Dropbox link no longer exists or was revoked";
    if (err.summary === "invalid_refresh_token")
      return "Dropbox authorization expired — re-mint DROPBOX_REFRESH_TOKEN";
    return `Dropbox error: ${err.summary || err.status}`;
  }
  return (err as Error)?.message || "Copy failed";
}

export async function importDropbox(data: { importId: string }): Promise<void> {
  const { importId } = data;
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!imp) {
    console.error(`[Import] Import ${importId} not found — skipping`);
    return;
  }

  const fail = (message: string) =>
    db
      .update(imports)
      .set({
        status: "error",
        errors: [{ fileName: "", path: "", message }],
        updatedAt: new Date(),
      })
      .where(eq(imports.id, importId));

  if (!isDropboxConfigured()) {
    await fail("Dropbox import isn't configured on the server (DROPBOX_* env vars missing)");
    return;
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, imp.clientId));
  if (!client?.driveFolderId) {
    await fail("Client or its Drive folder no longer exists");
    return;
  }

  await db
    .update(imports)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(imports.id, importId));

  const link = imp.sourceFolderId; // for dropbox imports this column holds the shared link URL

  try {
    console.log(`[Import] ${importId}: expanding Dropbox selection from "${imp.sourceFolderName}"...`);
    const plan = await buildCopyPlan(imp.selection, (path) =>
      withDropboxRetry(() => listSharedLinkFolder(link, path))
    );

    await db
      .update(imports)
      .set({ totalFiles: plan.length, updatedAt: new Date() })
      .where(eq(imports.id, importId));
    console.log(`[Import] ${importId}: ${plan.length} files to transfer into "${client.name}"`);

    const folderCache = new Map<string, string>();
    const namesCache = new Map<string, Set<string>>();
    const errors: ImportError[] = [];
    let copied = 0;
    let skipped = 0;

    const saveProgress = () =>
      db
        .update(imports)
        .set({ copiedFiles: copied, skippedFiles: skipped, errors, updatedAt: new Date() })
        .where(eq(imports.id, importId));

    for (const entry of plan) {
      const pathLabel = entry.relativePath.join("/");
      try {
        const destFolderId = await ensureFolderPath(
          client.driveFolderId,
          entry.relativePath,
          folderCache
        );
        const existing = await getExistingNames(destFolderId, namesCache);
        if (existing.has(entry.fileName)) {
          skipped++;
        } else {
          // Retry wraps download+upload together: a retried download needs a
          // fresh stream, so the upload can't be retried independently.
          await withDropboxRetry(async () => {
            const { stream } = await downloadSharedLinkFile(link, entry.sourceFileId);
            await uploadFileToDrive(destFolderId, entry.fileName, "application/octet-stream", stream);
          });
          existing.add(entry.fileName);
          copied++;
        }
      } catch (err) {
        const message = friendlyDropboxMessage(err);
        errors.push({ fileName: entry.fileName, path: pathLabel, message });
        console.error(`[Import] ${importId}: failed "${pathLabel}/${entry.fileName}": ${message}`);
      }

      if ((copied + skipped + errors.length) % 5 === 0) await saveProgress();
    }

    await db
      .update(imports)
      .set({
        status: errors.length > 0 ? "completed_with_errors" : "completed",
        copiedFiles: copied,
        skippedFiles: skipped,
        errors,
        updatedAt: new Date(),
      })
      .where(eq(imports.id, importId));
    console.log(
      `[Import] ${importId}: done — copied ${copied}, skipped ${skipped}, errors ${errors.length}`
    );

    // Ingest immediately instead of waiting for the next periodic sync pass.
    try {
      const { runDriveSync } = await import("../syncDrive");
      await runDriveSync();
    } catch (err) {
      console.error(`[Import] ${importId}: post-import sync failed:`, (err as Error).message);
    }
  } catch (err) {
    const message = friendlyDropboxMessage(err);
    console.error(`[Import] ${importId}: fatal:`, message);
    await fail(message);
    throw err;
  }
}
```

- [ ] **Step 2: Register the job in `worker/index.ts`** — add the import and a branch before the `else`:

```ts
import { importDropbox } from "./processors/importDropbox";
```

```ts
    } else if (job.name === "import-dropbox") {
      console.log(`[Worker] Job ${job.id} started — dropbox import: ${job.data.importId}`);
      await importDropbox(job.data);
      console.log(`[Worker] Job ${job.id} completed — dropbox import: ${job.data.importId}`);
    } else {
```

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: all green

- [ ] **Step 4: Commit**

```bash
git add worker/processors/importDropbox.ts worker/index.ts
git commit -m "feat: import-dropbox worker job — stream Dropbox shared links into Drive"
```

---

### Task 6: Browse API — auto-detect Dropbox links

**Files:**
- Modify: `src/app/api/import/browse/route.ts`

**Interfaces:**
- Consumes: `parseDropboxLink` (Task 1), `getSharedLinkMeta`/`listSharedLinkFolder`/`isDropboxConfigured`/`DropboxApiError` (Task 2).
- Produces: same response shape as today plus `source: "drive" | "dropbox"` and (for Dropbox) `link: <normalized url>`. Request body gains optional `path` + `link` combo for Dropbox subfolder expansion. Task 7's page relies on: root folder id `""` for Dropbox folder links; single-file links return one file with id `""`.

- [ ] **Step 1: Rewrite the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseDriveFolderLink } from "@/lib/driveLink";
import { parseDropboxLink } from "@/lib/dropboxLink";
import {
  isDropboxConfigured,
  getSharedLinkMeta,
  listSharedLinkFolder,
  DropboxApiError,
} from "@/lib/dropbox";
import { getDriveFolderMeta, listFolderChildren } from "@/lib/gdrive";

const NO_ACCESS_MESSAGE =
  "Couldn't open that folder. Make sure the link is a Google Drive folder and that it's either shared with the FootageStore Google account or set to \"anyone with the link can view\".";

const DROPBOX_UNCONFIGURED_MESSAGE = "Dropbox import isn't configured on the server.";

function dropboxErrorResponse(err: unknown) {
  if (err instanceof DropboxApiError) {
    if (err.summary.startsWith("shared_link_access_denied"))
      return NextResponse.json(
        {
          error: "No access",
          message:
            "That Dropbox link is password-protected or restricted — ask the sender to reshare it without a password.",
        },
        { status: 404 }
      );
    if (err.status === 409 || err.status === 404)
      return NextResponse.json(
        { error: "No access", message: "That Dropbox link doesn't exist or was revoked." },
        { status: 404 }
      );
  }
  console.error("[Import Browse] Dropbox error:", err);
  return NextResponse.json(
    { error: "Browse failed", message: (err as Error).message },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { link, folderId, path } = body as { link?: string; folderId?: string; path?: string };

  // Drive subfolder expansion (existing behavior)
  if (typeof folderId === "string" && folderId) {
    return browseDrive(folderId);
  }

  if (typeof link !== "string" || !link) {
    return NextResponse.json({ error: "link or folderId is required" }, { status: 400 });
  }

  const dropbox = parseDropboxLink(link);
  if (dropbox) {
    if (!isDropboxConfigured()) {
      return NextResponse.json(
        { error: "Not configured", message: DROPBOX_UNCONFIGURED_MESSAGE },
        { status: 400 }
      );
    }
    try {
      // Subfolder expansion: page sends the link back with a relative path.
      if (typeof path === "string" && path) {
        const children = await listSharedLinkFolder(dropbox.url, path);
        const name = path.split("/").pop() || "";
        return NextResponse.json({
          folder: { id: path, name },
          ...children,
          source: "dropbox",
          link: dropbox.url,
        });
      }
      const meta = await getSharedLinkMeta(dropbox.url);
      if (!meta.isFolder) {
        // Single-file link: one-file listing so the normal selection UI works.
        return NextResponse.json({
          folder: { id: "", name: meta.name },
          folders: [],
          files: [
            { id: "", name: meta.name, mimeType: "application/octet-stream", size: meta.size },
          ],
          source: "dropbox",
          link: dropbox.url,
        });
      }
      const children = await listSharedLinkFolder(dropbox.url, "");
      return NextResponse.json({
        folder: { id: "", name: meta.name },
        ...children,
        source: "dropbox",
        link: dropbox.url,
      });
    } catch (err) {
      return dropboxErrorResponse(err);
    }
  }

  const driveId = parseDriveFolderLink(link);
  if (!driveId) {
    return NextResponse.json(
      {
        error: "Invalid link",
        message:
          "That doesn't look like a Google Drive or Dropbox link. Paste a link like https://drive.google.com/drive/folders/… or https://www.dropbox.com/scl/fo/…",
      },
      { status: 400 }
    );
  }
  return browseDrive(driveId);
}

async function browseDrive(targetId: string) {
  try {
    const [folder, children] = await Promise.all([
      getDriveFolderMeta(targetId),
      listFolderChildren(targetId),
    ]);
    return NextResponse.json({ folder, ...children, source: "drive" });
  } catch (err) {
    const status = (err as { code?: number }).code;
    if (status === 404 || status === 403) {
      return NextResponse.json({ error: "No access", message: NO_ACCESS_MESSAGE }, { status: 404 });
    }
    console.error("[Import Browse] Error:", err);
    return NextResponse.json(
      { error: "Browse failed", message: (err as Error).message },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: all green

- [ ] **Step 3: Commit**

```bash
git add src/app/api/import/browse/route.ts
git commit -m "feat: browse API auto-detects Dropbox shared links"
```

---

### Task 7: Import API + page UI

**Files:**
- Modify: `src/app/api/import/route.ts`
- Modify: `src/app/(app)/import/page.tsx`

**Interfaces:**
- Consumes: browse response `source`/`link` fields (Task 6); `imports.source` column (Task 3); job name `"import-dropbox"` (Task 5).
- Produces: `POST /api/import` accepts optional `source: "drive" | "dropbox"` (default `"drive"`).

- [ ] **Step 1: Update `src/app/api/import/route.ts`**

Add to the body destructure + types:

```ts
  const { clientId, sourceFolderId, sourceFolderName, selection, source } = body as {
    clientId?: string;
    sourceFolderId?: string;
    sourceFolderName?: string;
    selection?: ImportSelection;
    source?: "drive" | "dropbox";
  };
  const importSource: "drive" | "dropbox" = source === "dropbox" ? "dropbox" : "drive";
```

Add `source: importSource` to the `.values({...})` insert, and change the enqueue line to:

```ts
  await getClipQueue().add(
    importSource === "dropbox" ? "import-dropbox" : "import-drive",
    { importId: row.id },
    { jobId: row.id }
  );
```

- [ ] **Step 2: Update `src/app/(app)/import/page.tsx`** — five small diffs:

**(a)** Extend `browse()` (line ~58) to pass through `path` and return `source`:

```ts
async function browse(body: { link?: string; folderId?: string; path?: string }) {
  const res = await fetch("/api/import/browse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Browse failed");
  return data as {
    folder: BrowseFolder;
    folders: BrowseFolder[];
    files: BrowseFile[];
    source?: "drive" | "dropbox";
    link?: string;
  };
}
```

**(b)** Add state after `const [root, setRoot] = ...`:

```ts
  const [source, setSource] = useState<"drive" | "dropbox">("drive");
  const activeLink = useRef("");
```

**(c)** In `handleResolve`, after `const data = await browse({ link: link.trim() });`:

```ts
      setSource(data.source ?? "drive");
      activeLink.current = data.link ?? link.trim();
```

**(d)** In `toggleExpand`, change the browse call to:

```ts
        const data = await browse(
          source === "dropbox"
            ? { link: activeLink.current, path: node.id }
            : { folderId: node.id }
        );
```

**(e)** In `handleStart`, include the source and the right root id:

```ts
        body: JSON.stringify({
          clientId,
          sourceFolderId: source === "dropbox" ? activeLink.current : root.id,
          sourceFolderName: root.name,
          selection,
          source,
        }),
```

**(f)** Copy updates: page heading `Import from Drive` → `Import footage`; intro sentence → `Paste a link to a Google Drive or Dropbox folder that's been shared with us, choose what to bring in, and it's copied into a client folder — then picked up by the library automatically.`; input placeholder → `https://drive.google.com/… or https://www.dropbox.com/scl/fo/…`; the running label `Copying into Drive…` stays (still true for Dropbox).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green, Next build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/api/import/route.ts "src/app/(app)/import/page.tsx"
git commit -m "feat: import UI + API accept Dropbox links"
```

---

### Task 8: Compose env wiring + docs + Dropbox app setup guide

**Files:**
- Modify: `docker-compose.yml` (app + worker `environment` blocks)
- Modify: `CLAUDE.md` (env vars + key files sections)
- Create: `docs/dropbox-setup.md`

- [ ] **Step 1: Add to BOTH `app` and `worker` `environment:` lists in `docker-compose.yml`** (next to the `GOOGLE_*` vars):

```yaml
      - DROPBOX_APP_KEY=${DROPBOX_APP_KEY}
      - DROPBOX_APP_SECRET=${DROPBOX_APP_SECRET}
      - DROPBOX_REFRESH_TOKEN=${DROPBOX_REFRESH_TOKEN}
```

- [ ] **Step 2: Write `docs/dropbox-setup.md`** (the one-time token mint):

```markdown
# Dropbox import — one-time app setup

The importer browses/downloads Dropbox shared links via a Dropbox app on the
Fraggell Dropbox account. The account does not need to own the linked files.

1. https://www.dropbox.com/developers/apps → Create app → "Scoped access" →
   "Full Dropbox" (needed for shared-link reads) → name it `FootageStore Import`.
2. Permissions tab → enable `sharing.read`, `files.metadata.read`,
   `files.content.read` → Submit.
3. Settings tab → note the App key and App secret.
4. In a browser (logged into the Fraggell Dropbox), visit:
   https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline
   Approve, copy the code shown.
5. Exchange the code for a refresh token:
   curl https://api.dropbox.com/oauth2/token \
     -d code=THE_CODE -d grant_type=authorization_code \
     -u APP_KEY:APP_SECRET
   The response's `refresh_token` is long-lived (no expiry).
6. Add to `/mnt/user/appdata/footagestore/app/.env` on the Unraid:
   DROPBOX_APP_KEY=…
   DROPBOX_APP_SECRET=…
   DROPBOX_REFRESH_TOKEN=…
7. `docker compose up -d app worker` to pick up the env.
```

- [ ] **Step 3: Update `CLAUDE.md`**

In **Environment Variables**, add after the `GOOGLE_*` lines:

```markdown
- `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` / `DROPBOX_REFRESH_TOKEN` — Dropbox shared-link import (app + worker). If unset, Dropbox links are rejected at browse time with a clear message; Drive import is unaffected. Setup: `docs/dropbox-setup.md`.
```

In **Key Files**, extend the import line:

```markdown
- `src/app/(app)/import/` + `worker/processors/importDrive.ts` / `importDropbox.ts` — import tool (copy footage from external Drive folders or Dropbox shared links into a client folder; shared helpers in `importShared.ts`)
```

- [ ] **Step 4: Final check + commit**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green

```bash
git add docker-compose.yml CLAUDE.md docs/dropbox-setup.md
git commit -m "chore: Dropbox env wiring + setup docs"
```

---

## Deploy checklist (after PR merge — not part of implementation tasks)

1. Mint the Dropbox refresh token per `docs/dropbox-setup.md`; add the three vars to the server `.env` **before** merging (the webhook deploy will recreate containers).
2. Back up Postgres (`pg_dump` per CLAUDE.md) — this deploy includes a migration.
3. Apply the migration via psql (drizzle-kit is pruned from the prod image):
   `docker exec -i app-db-1 psql -U footagestore footagestore < drizzle/0005_imports_dropbox_source.sql`
4. Webhook deploy is unreliable at rebuilding — verify both containers were recreated (`docker ps`), and `docker compose up -d --build app worker` manually if not.
5. Smoke test: paste a real Dropbox shared folder link on `/import`, import 1 small file into a test client, confirm it appears in the client's Drive folder and ingests.
```
