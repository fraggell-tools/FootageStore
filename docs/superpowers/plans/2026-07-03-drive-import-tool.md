# Drive Import Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins paste an external Google Drive folder link, browse/select its contents in a tree, and copy the selection server-side (`drive.files.copy`) into a client folder under Footage Storage, where the existing sync ingests it.

**Architecture:** New admin page (`/admin/import`) drives three new API routes (browse / create import / poll status). An `imports` DB row tracks progress; the actual copying runs as a new `import-drive` job on the existing `clip-processing` BullMQ queue, handled by a new worker processor that expands the selection into a copy plan, mirrors the folder tree, copies file-by-file with rate-limit retries, then triggers a Drive sync.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (Postgres), BullMQ, googleapis (`drive_v3`), vitest (new devDependency).

**Spec:** `docs/superpowers/specs/2026-07-03-drive-import-design.md`

## Global Constraints

- Prod Postgres has **no `__drizzle_migrations` table** — every migration statement must be idempotent (`CREATE TABLE IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object THEN null …`).
- All Drive API calls must pass `supportsAllDrives: true`; list calls also `includeItemsFromAllDrives: true`.
- Admin-mutation API guard pattern (copy exactly, see `src/app/api/sync/route.ts:6-9`): `const session = await auth(); if (!session) → 401; if (session.user.role !== "admin") → 403;`
- DB columns snake_case with explicit names, camelCase TS keys, `pgEnum` for status enums, uuid `defaultRandom()` PKs (existing convention in `src/lib/db/schema.ts`).
- Footage is never persisted locally; this feature moves bytes only inside Google Drive.
- Run all commands from the repo root: `/Users/fraser/Documents/Claude Code/FootageStore`.

---

### Task 1: Vitest setup + Drive link parser

**Files:**
- Modify: `package.json` (add vitest devDependency + `test` script)
- Create: `src/lib/driveLink.ts`
- Test: `src/lib/driveLink.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseDriveFolderLink(input: string): string | null` — accepts a Drive folder URL or raw folder ID, returns the folder ID or null. Used by the browse API (Task 5).

- [ ] **Step 1: Install vitest and add the test script**

```bash
npm install --save-dev vitest
```

Then in `package.json` add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/driveLink.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDriveFolderLink } from "./driveLink";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz12345";

describe("parseDriveFolderLink", () => {
  it("parses a standard folders URL", () => {
    expect(parseDriveFolderLink(`https://drive.google.com/drive/folders/${ID}`)).toBe(ID);
  });

  it("parses a folders URL with ?usp=sharing", () => {
    expect(parseDriveFolderLink(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toBe(ID);
  });

  it("parses a user-scoped URL (/drive/u/0/folders/...)", () => {
    expect(parseDriveFolderLink(`https://drive.google.com/drive/u/0/folders/${ID}`)).toBe(ID);
  });

  it("parses an open?id= URL", () => {
    expect(parseDriveFolderLink(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
  });

  it("accepts a raw folder ID", () => {
    expect(parseDriveFolderLink(ID)).toBe(ID);
  });

  it("trims surrounding whitespace", () => {
    expect(parseDriveFolderLink(`  https://drive.google.com/drive/folders/${ID}  `)).toBe(ID);
  });

  it("rejects non-Google URLs", () => {
    expect(parseDriveFolderLink(`https://evil.com/drive/folders/${ID}`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseDriveFolderLink("not a link")).toBeNull();
    expect(parseDriveFolderLink("")).toBeNull();
    expect(parseDriveFolderLink("https://drive.google.com/drive/my-drive")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/driveLink.test.ts`
Expected: FAIL — cannot resolve `./driveLink`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/driveLink.ts`:

```ts
/**
 * Parse a Google Drive folder link (or raw folder ID) into a folder ID.
 * Supported forms:
 *   https://drive.google.com/drive/folders/<id>[?usp=sharing]
 *   https://drive.google.com/drive/u/<n>/folders/<id>
 *   https://drive.google.com/open?id=<id>
 *   <raw id>
 * Returns null if the input can't be interpreted as a Drive folder.
 */
const FOLDER_ID_RE = /^[a-zA-Z0-9_-]{10,}$/;

export function parseDriveFolderLink(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (FOLDER_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null;

  const folderMatch = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folderMatch) return folderMatch[1];

  const idParam = url.searchParams.get("id");
  if (idParam && FOLDER_ID_RE.test(idParam)) return idParam;

  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/driveLink.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/driveLink.ts src/lib/driveLink.test.ts
git commit -m "feat: add vitest + Drive folder link parser"
```

---

### Task 2: Drive helper additions in gdrive.ts

**Files:**
- Modify: `src/lib/gdrive.ts` (append after `listFilesInFolder`, ~line 309)

**Interfaces:**
- Consumes: existing private `getDrive()` singleton in the same file.
- Produces (all exported; used by Tasks 4–6):
  - `interface DriveFolderChildren { folders: { id: string; name: string }[]; files: { id: string; name: string; mimeType: string; size: number }[] }`
  - `getDriveFolderMeta(folderId: string): Promise<{ id: string; name: string }>`
  - `listFolderChildren(folderId: string): Promise<DriveFolderChildren>` — ONE level, not recursive
  - `copyDriveFile(fileId: string, destFolderId: string): Promise<string>` — returns new file ID
  - `findChildFolderByName(parentId: string, name: string): Promise<string | null>`
  - `createFolder(parentId: string, name: string): Promise<string>` — arbitrary parent (unlike `createClientFolder`, which is pinned to the Footage Storage root)

These are thin googleapis wrappers with no extractable logic — no unit tests; they're exercised by the manual end-to-end verification in Task 8 and must compile clean.

- [ ] **Step 1: Append the helpers**

Add to the end of `src/lib/gdrive.ts`:

```ts
export interface DriveFolderChildren {
  folders: { id: string; name: string }[];
  files: { id: string; name: string; mimeType: string; size: number }[];
}

/**
 * Get the name of an arbitrary Drive folder (e.g. an externally shared one).
 * Throws the googleapis error (404/403) if the app's account can't see it.
 */
export async function getDriveFolderMeta(
  folderId: string
): Promise<{ id: string; name: string }> {
  const drive = getDrive();
  const res = await drive.files.get({
    fileId: folderId,
    supportsAllDrives: true,
    fields: "id, name, mimeType",
  });
  if (res.data.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("Not a folder");
  }
  return { id: res.data.id!, name: res.data.name! };
}

/**
 * List the direct children of a folder (one level — no recursion).
 * Works on folders outside our parent, e.g. externally shared ones.
 */
export async function listFolderChildren(
  folderId: string
): Promise<DriveFolderChildren> {
  const drive = getDrive();
  const folders: DriveFolderChildren["folders"] = [];
  const files: DriveFolderChildren["files"] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken,
    });

    for (const f of res.data.files || []) {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        folders.push({ id: f.id!, name: f.name! });
      } else {
        files.push({
          id: f.id!,
          name: f.name!,
          mimeType: f.mimeType || "application/octet-stream",
          size: parseInt(f.size || "0", 10),
        });
      }
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { folders, files };
}

/**
 * Server-side copy of a Drive file into one of our folders.
 * Fails with reason "cannotCopyFile" when the source owner disabled
 * download/copy for viewers.
 */
export async function copyDriveFile(
  fileId: string,
  destFolderId: string
): Promise<string> {
  const drive = getDrive();
  const res = await drive.files.copy({
    fileId,
    supportsAllDrives: true,
    requestBody: { parents: [destFolderId] },
    fields: "id",
  });
  return res.data.id!;
}

/**
 * Find a direct child folder by exact name. Returns its ID or null.
 */
export async function findChildFolderByName(
  parentId: string,
  name: string
): Promise<string | null> {
  const drive = getDrive();
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1,
  });
  return res.data.files?.[0]?.id || null;
}

/**
 * Create a folder under an arbitrary parent folder.
 */
export async function createFolder(
  parentId: string,
  name: string
): Promise<string> {
  const drive = getDrive();
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  return res.data.id!;
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (pre-existing warnings, if any, unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/lib/gdrive.ts
git commit -m "feat: Drive helpers for external folder browse + server-side copy"
```

---

### Task 3: `imports` table — schema + idempotent migration

**Files:**
- Modify: `src/lib/db/schema.ts` (append after `collectionClips`)
- Create (generated then edited): `drizzle/0002_imports_table.sql` + `drizzle/meta/` updates via drizzle-kit

**Interfaces:**
- Consumes: existing `clients`, `users` tables in the same file.
- Produces: exported `importStatusEnum`, `imports` table, and types:
  - `type ImportSelection = { folders: { id: string; name: string }[]; files: { id: string; name: string }[] }`
  - `type ImportError = { fileName: string; path: string; message: string }`
  - `imports` columns (TS keys): `id`, `clientId`, `sourceFolderId`, `sourceFolderName`, `selection` (ImportSelection), `status` (`pending | running | completed | completed_with_errors | error`), `totalFiles`, `copiedFiles`, `skippedFiles`, `errors` (ImportError[] | null), `createdBy`, `createdAt`, `updatedAt`

- [ ] **Step 1: Add the schema**

Append to `src/lib/db/schema.ts`:

```ts
export const importStatusEnum = pgEnum("import_status", [
  "pending",
  "running",
  "completed",
  "completed_with_errors",
  "error",
]);

export type ImportSelection = {
  folders: { id: string; name: string }[];
  files: { id: string; name: string }[];
};

export type ImportError = { fileName: string; path: string; message: string };

export const imports = pgTable("imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  sourceFolderId: varchar("source_folder_id", { length: 255 }).notNull(),
  sourceFolderName: varchar("source_folder_name", { length: 500 }).notNull(),
  selection: jsonb("selection").$type<ImportSelection>().notNull(),
  status: importStatusEnum("status").notNull().default("pending"),
  totalFiles: integer("total_files").notNull().default(0),
  copiedFiles: integer("copied_files").notNull().default(0),
  skippedFiles: integer("skipped_files").notNull().default(0),
  errors: jsonb("errors").$type<ImportError[]>(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate -- --name imports_table`
Expected: creates `drizzle/0002_imports_table.sql` and updates `drizzle/meta/`.

- [ ] **Step 3: Make the migration idempotent**

Prod was built with `drizzle-kit push` (no migrations table), so edit the generated `drizzle/0002_imports_table.sql` to be safe to re-run. Final content must be exactly:

```sql
-- imports table for the Drive import tool (admin bulk-copy from external shared folders).
-- Like 0000/0001 this runs against a push-originated database with no
-- __drizzle_migrations table, so every statement is idempotent.

DO $$ BEGIN
 CREATE TYPE "public"."import_status" AS ENUM('pending', 'running', 'completed', 'completed_with_errors', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"source_folder_id" varchar(255) NOT NULL,
	"source_folder_name" varchar(500) NOT NULL,
	"selection" jsonb NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"copied_files" integer DEFAULT 0 NOT NULL,
	"skipped_files" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imports" ADD CONSTRAINT "imports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
```

(If drizzle-kit generated slightly different constraint names, keep the generated names — only add the idempotency guards.)

- [ ] **Step 4: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat: imports table for Drive import tracking (idempotent migration)"
```

---

### Task 4: Copy-plan builder + rate-limit retry helper (worker, pure logic)

**Files:**
- Create: `worker/processors/importPlan.ts`
- Create: `worker/processors/driveRetry.ts`
- Test: `worker/processors/importPlan.test.ts`
- Test: `worker/processors/driveRetry.test.ts`

**Interfaces:**
- Consumes: `DriveFolderChildren` type from `src/lib/gdrive.ts` (Task 2); `ImportSelection` from `src/lib/db/schema.ts` (Task 3).
- Produces (used by Task 6):
  - `interface CopyPlanEntry { sourceFileId: string; fileName: string; relativePath: string[] }` — `relativePath` is folder names from the client folder down, `[]` = client folder root.
  - `buildCopyPlan(selection: ImportSelection, listChildren: (folderId: string) => Promise<DriveFolderChildren>): Promise<CopyPlanEntry[]>`
  - `withDriveRetry<T>(fn: () => Promise<T>, opts?: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<T>`
  - `isRetryableDriveError(err: unknown): boolean`

- [ ] **Step 1: Write the failing tests**

Create `worker/processors/importPlan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCopyPlan } from "./importPlan";
import type { DriveFolderChildren } from "../../src/lib/gdrive";

function fakeLister(tree: Record<string, DriveFolderChildren>) {
  return async (folderId: string): Promise<DriveFolderChildren> =>
    tree[folderId] ?? { folders: [], files: [] };
}

describe("buildCopyPlan", () => {
  it("puts individually selected files at the destination root", async () => {
    const plan = await buildCopyPlan(
      { folders: [], files: [{ id: "f1", name: "clip.mp4" }] },
      fakeLister({})
    );
    expect(plan).toEqual([
      { sourceFileId: "f1", fileName: "clip.mp4", relativePath: [] },
    ]);
  });

  it("recurses selected folders, preserving the path from the folder's own name down", async () => {
    const plan = await buildCopyPlan(
      { folders: [{ id: "raw", name: "Raw" }], files: [] },
      fakeLister({
        raw: {
          folders: [{ id: "day1", name: "Day 1" }],
          files: [{ id: "a", name: "a.mp4", mimeType: "video/mp4", size: 1 }],
        },
        day1: {
          folders: [],
          files: [{ id: "b", name: "b.mp4", mimeType: "video/mp4", size: 2 }],
        },
      })
    );
    expect(plan).toContainEqual({ sourceFileId: "a", fileName: "a.mp4", relativePath: ["Raw"] });
    expect(plan).toContainEqual({ sourceFileId: "b", fileName: "b.mp4", relativePath: ["Raw", "Day 1"] });
    expect(plan).toHaveLength(2);
  });

  it("handles a mixed selection and empty folders", async () => {
    const plan = await buildCopyPlan(
      {
        folders: [{ id: "empty", name: "Empty" }],
        files: [{ id: "x", name: "x.mov" }],
      },
      fakeLister({ empty: { folders: [], files: [] } })
    );
    expect(plan).toEqual([
      { sourceFileId: "x", fileName: "x.mov", relativePath: [] },
    ]);
  });

  it("returns [] for an empty selection", async () => {
    const plan = await buildCopyPlan({ folders: [], files: [] }, fakeLister({}));
    expect(plan).toEqual([]);
  });
});
```

Create `worker/processors/driveRetry.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { withDriveRetry, isRetryableDriveError } from "./driveRetry";

const rateLimit403 = { code: 403, errors: [{ reason: "userRateLimitExceeded" }] };
const tooMany429 = { code: 429 };
const forbidden = { code: 403, errors: [{ reason: "cannotCopyFile" }] };

describe("isRetryableDriveError", () => {
  it("retries 429", () => expect(isRetryableDriveError(tooMany429)).toBe(true));
  it("retries 403 rate limits", () => expect(isRetryableDriveError(rateLimit403)).toBe(true));
  it("does not retry cannotCopyFile", () => expect(isRetryableDriveError(forbidden)).toBe(false));
  it("does not retry unknown errors", () => expect(isRetryableDriveError(new Error("boom"))).toBe(false));
});

describe("withDriveRetry", () => {
  it("returns the result on first success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const result = await withDriveRetry(async () => 42, { sleep });
    expect(result).toBe(42);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries retryable errors with growing backoff, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const result = await withDriveRetry(
      async () => {
        calls++;
        if (calls < 3) throw tooMany429;
        return "ok";
      },
      { baseDelayMs: 100, sleep }
    );
    expect(result).toBe("ok");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[1][0]).toBeGreaterThan(sleep.mock.calls[0][0]);
  });

  it("throws immediately on non-retryable errors", async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      withDriveRetry(async () => { throw forbidden; }, { sleep })
    ).rejects.toBe(forbidden);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the retry budget", async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      withDriveRetry(async () => { throw tooMany429; }, { retries: 2, sleep })
    ).rejects.toBe(tooMany429);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run worker/processors`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

Create `worker/processors/importPlan.ts`:

```ts
import type { DriveFolderChildren } from "../../src/lib/gdrive";
import type { ImportSelection } from "../../src/lib/db/schema";

export interface CopyPlanEntry {
  sourceFileId: string;
  fileName: string;
  /** Folder names from the destination client folder down. [] = client folder root. */
  relativePath: string[];
}

/**
 * Expand a user selection (top-level checked folders + individually checked
 * files) into a flat list of file copies with destination paths. Selected
 * folders keep their own name as the top of their subtree in the destination.
 */
export async function buildCopyPlan(
  selection: ImportSelection,
  listChildren: (folderId: string) => Promise<DriveFolderChildren>
): Promise<CopyPlanEntry[]> {
  const plan: CopyPlanEntry[] = [];

  for (const file of selection.files) {
    plan.push({ sourceFileId: file.id, fileName: file.name, relativePath: [] });
  }

  const stack = selection.folders.map((f) => ({ id: f.id, path: [f.name] }));
  while (stack.length > 0) {
    const { id, path } = stack.pop()!;
    const children = await listChildren(id);
    for (const file of children.files) {
      plan.push({ sourceFileId: file.id, fileName: file.name, relativePath: path });
    }
    for (const folder of children.folders) {
      stack.push({ id: folder.id, path: [...path, folder.name] });
    }
  }

  return plan;
}
```

Create `worker/processors/driveRetry.ts`:

```ts
interface GoogleApiErrorShape {
  code?: number;
  response?: { status?: number };
  errors?: { reason?: string }[];
}

/** 429s and 403 rate-limit responses are transient; everything else is not. */
export function isRetryableDriveError(err: unknown): boolean {
  const e = err as GoogleApiErrorShape;
  const status = e?.code ?? e?.response?.status;
  if (status === 429) return true;
  if (status === 403) {
    const reason = e?.errors?.[0]?.reason || "";
    return reason === "rateLimitExceeded" || reason === "userRateLimitExceeded";
  }
  return false;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a Drive call, retrying rate-limit errors with exponential backoff + jitter.
 */
export async function withDriveRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<T> {
  const { retries = 5, baseDelayMs = 2000, sleep = defaultSleep } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableDriveError(err) || attempt >= retries) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 1000;
      await sleep(delay);
      attempt++;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run worker/processors`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add worker/processors/importPlan.ts worker/processors/importPlan.test.ts worker/processors/driveRetry.ts worker/processors/driveRetry.test.ts
git commit -m "feat: copy-plan builder + Drive rate-limit retry helper"
```

---

### Task 5: API routes — browse, create import, poll status

**Files:**
- Create: `src/app/api/admin/import/browse/route.ts`
- Create: `src/app/api/admin/import/route.ts`
- Create: `src/app/api/admin/import/[importId]/route.ts`

**Interfaces:**
- Consumes: `parseDriveFolderLink` (Task 1); `getDriveFolderMeta`, `listFolderChildren` (Task 2); `imports`, `clients`, `ImportSelection` from schema (Task 3); `auth` from `@/lib/auth`; `db` from `@/lib/db`; `getClipQueue` from `@/lib/queue`.
- Produces (consumed by the UI, Task 7):
  - `POST /api/admin/import/browse` body `{ link?: string; folderId?: string }` → `{ folder: { id, name }, folders: [{id,name}], files: [{id,name,mimeType,size}] }`. `link` is used on first resolve (returns the root folder's meta + children); `folderId` on tree expansion. Errors: 400 (unparsable link / missing input), 404 (Drive says not found / no access) with `{ error, message }`.
  - `POST /api/admin/import` body `{ clientId: string; sourceFolderId: string; sourceFolderName: string; selection: ImportSelection }` → 201 `{ id }`. Enqueues BullMQ job `"import-drive"` with data `{ importId }`, `jobId: importId`.
  - `GET /api/admin/import/<id>` → the full imports row.

- [ ] **Step 1: Create the browse route**

Create `src/app/api/admin/import/browse/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseDriveFolderLink } from "@/lib/driveLink";
import { getDriveFolderMeta, listFolderChildren } from "@/lib/gdrive";

const NO_ACCESS_MESSAGE =
  "Couldn't open that folder. Make sure the link is a Google Drive folder and that it's either shared with the FootageStore Google account or set to \"anyone with the link can view\".";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { link, folderId } = body as { link?: string; folderId?: string };

  let targetId: string | null = null;
  if (typeof folderId === "string" && folderId) {
    targetId = folderId;
  } else if (typeof link === "string" && link) {
    targetId = parseDriveFolderLink(link);
    if (!targetId) {
      return NextResponse.json(
        { error: "Invalid link", message: "That doesn't look like a Google Drive folder link. Paste a link like https://drive.google.com/drive/folders/…" },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json({ error: "link or folderId is required" }, { status: 400 });
  }

  try {
    const [folder, children] = await Promise.all([
      getDriveFolderMeta(targetId),
      listFolderChildren(targetId),
    ]);
    return NextResponse.json({ folder, ...children });
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

- [ ] **Step 2: Create the import-creation route**

Create `src/app/api/admin/import/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients, imports, type ImportSelection } from "@/lib/db/schema";
import { getClipQueue } from "@/lib/queue";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { clientId, sourceFolderId, sourceFolderName, selection } = body as {
    clientId?: string;
    sourceFolderId?: string;
    sourceFolderName?: string;
    selection?: ImportSelection;
  };

  if (!clientId || !sourceFolderId || !sourceFolderName) {
    return NextResponse.json({ error: "clientId, sourceFolderId and sourceFolderName are required" }, { status: 400 });
  }
  const hasFolders = Array.isArray(selection?.folders) && selection.folders.length > 0;
  const hasFiles = Array.isArray(selection?.files) && selection.files.length > 0;
  if (!hasFolders && !hasFiles) {
    return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!client.driveFolderId) {
    return NextResponse.json({ error: "Client has no Drive folder — re-create it or run a sync first" }, { status: 400 });
  }

  const [row] = await db
    .insert(imports)
    .values({
      clientId,
      sourceFolderId,
      sourceFolderName,
      selection: { folders: selection!.folders ?? [], files: selection!.files ?? [] },
      createdBy: session.user.id ?? null,
    })
    .returning({ id: imports.id });

  await getClipQueue().add("import-drive", { importId: row.id }, { jobId: row.id });

  return NextResponse.json({ id: row.id }, { status: 201 });
}
```

Note: if `session.user.id` is not present on the session type in this repo, use `null` for `createdBy` rather than fighting the auth types — check `src/lib/auth.ts` for what the session actually carries.

- [ ] **Step 3: Create the status route**

Create `src/app/api/admin/import/[importId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ importId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { importId } = await params;
  const [row] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(row);
}
```

(Next 16 App Router passes `params` as a Promise — check a neighbouring dynamic route like `src/app/api/clients/[clientId]/route.ts` and match its exact signature style.)

- [ ] **Step 4: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/import
git commit -m "feat: import API routes — browse, create, status"
```

---

### Task 6: Worker processor `importDrive` + queue dispatch

**Files:**
- Create: `worker/processors/importDrive.ts`
- Modify: `worker/index.ts:22-35` (dispatch by job name)

**Interfaces:**
- Consumes: `buildCopyPlan`, `CopyPlanEntry` (Task 4); `withDriveRetry` (Task 4); `listFolderChildren`, `copyDriveFile`, `findChildFolderByName`, `createFolder` (Task 2); `imports`, `clients`, `ImportError` from schema (Task 3); `db` from `src/lib/db`; `syncFromDrive` from `src/lib/sync`.
- Produces: `importDrive(data: { importId: string }): Promise<void>` — consumed only by `worker/index.ts`.

- [ ] **Step 1: Write the processor**

Create `worker/processors/importDrive.ts`:

```ts
/**
 * import-drive job: copy a selection of files/folders from an external shared
 * Drive folder into a client folder, preserving structure, then trigger a
 * Drive sync so the new files get ingested immediately.
 */
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { clients, imports, type ImportError } from "../../src/lib/db/schema";
import {
  listFolderChildren,
  copyDriveFile,
  findChildFolderByName,
  createFolder,
} from "../../src/lib/gdrive";
import { buildCopyPlan } from "./importPlan";
import { withDriveRetry } from "./driveRetry";
import { syncFromDrive } from "../../src/lib/sync";

/** Resolve (find or create) the destination folder for a relative path, cached. */
async function ensureFolderPath(
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
async function getExistingNames(
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

export async function importDrive(data: { importId: string }): Promise<void> {
  const { importId } = data;
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!imp) {
    console.error(`[Import] Import ${importId} not found — skipping`);
    return;
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, imp.clientId));
  if (!client?.driveFolderId) {
    await db
      .update(imports)
      .set({
        status: "error",
        errors: [{ fileName: "", path: "", message: "Client or its Drive folder no longer exists" }],
        updatedAt: new Date(),
      })
      .where(eq(imports.id, importId));
    return;
  }

  await db
    .update(imports)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(imports.id, importId));

  try {
    console.log(`[Import] ${importId}: expanding selection from "${imp.sourceFolderName}"...`);
    const plan = await buildCopyPlan(imp.selection, (folderId) =>
      withDriveRetry(() => listFolderChildren(folderId))
    );

    await db
      .update(imports)
      .set({ totalFiles: plan.length, updatedAt: new Date() })
      .where(eq(imports.id, importId));
    console.log(`[Import] ${importId}: ${plan.length} files to copy into "${client.name}"`);

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
          await withDriveRetry(() => copyDriveFile(entry.sourceFileId, destFolderId));
          existing.add(entry.fileName);
          copied++;
        }
      } catch (err) {
        const e = err as { errors?: { reason?: string }[]; message?: string };
        const reason = e?.errors?.[0]?.reason;
        const message =
          reason === "cannotCopyFile"
            ? "Source owner has disabled copying/downloading for viewers"
            : e?.message || "Copy failed";
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

    // Ingest immediately instead of waiting for the next periodic sync.
    try {
      await syncFromDrive();
    } catch (err) {
      console.error(`[Import] ${importId}: post-import sync failed:`, (err as Error).message);
    }
  } catch (err) {
    console.error(`[Import] ${importId}: fatal:`, (err as Error).message);
    await db
      .update(imports)
      .set({
        status: "error",
        errors: [{ fileName: "", path: "", message: (err as Error).message }],
        updatedAt: new Date(),
      })
      .where(eq(imports.id, importId));
    throw err;
  }
}
```

- [ ] **Step 2: Dispatch by job name in the worker**

In `worker/index.ts`, add the import at the top:

```ts
import { importDrive } from "./processors/importDrive";
```

and replace the worker handler (lines 22-35) with:

```ts
const worker = new Worker(
  "clip-processing",
  async (job) => {
    recordJobActivity();
    if (job.name === "import-drive") {
      console.log(`[Worker] Job ${job.id} started — import: ${job.data.importId}`);
      await importDrive(job.data);
      console.log(`[Worker] Job ${job.id} completed — import: ${job.data.importId}`);
    } else {
      console.log(`[Worker] Job ${job.id} started — clipId: ${job.data.clipId}`);
      await processClip(job.data);
      console.log(`[Worker] Job ${job.id} completed — clipId: ${job.data.clipId}`);
    }
    recordJobActivity();
  },
  {
    connection: createRedisConnection(),
    concurrency: 2,
  }
);
```

- [ ] **Step 3: Verify compile + all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: compile clean, all tests pass.

Note: check how `src/lib/sync.ts` exports `syncFromDrive` and that importing it from the worker doesn't drag in Next-only modules; the worker runs under tsx, same as `syncDrive.ts` which already imports from `src/lib/`. If `src/lib/sync.ts` imports something Next-specific, call the sync via a `new Queue(...)`-style fallback — but verify first, don't assume.

- [ ] **Step 4: Commit**

```bash
git add worker/processors/importDrive.ts worker/index.ts
git commit -m "feat: import-drive worker processor with structure-preserving copy"
```

---

### Task 7: Import UI page + sidebar link

**Files:**
- Create: `src/app/(app)/admin/import/page.tsx`
- Create: `src/app/(app)/admin/import/ImportTool.tsx`
- Modify: `src/components/layout/Sidebar.tsx:31-41` (add to `adminItems`)

**Interfaces:**
- Consumes: the three API routes (Task 5), `GET /api/clients` and `POST /api/clients` (existing).
- Produces: user-facing page; nothing programmatic.

Selection semantics (implement exactly): checking a folder selects its whole subtree — its children render checked and disabled. The submitted selection contains only *top-level* checked nodes: checked folders with no checked ancestor (sent as `{id, name}`), and checked files whose ancestors are all unchecked. Checking the root source folder = "select all".

- [ ] **Step 1: Create the page wrapper**

`src/app/(app)/admin/import/page.tsx` (the existing `admin/layout.tsx` already enforces the admin guard):

```tsx
import ImportTool from "./ImportTool";

export const metadata = { title: "Import from Drive — Fraggell Footage" };

export default function ImportPage() {
  return <ImportTool />;
}
```

- [ ] **Step 2: Create the ImportTool client component**

`src/app/(app)/admin/import/ImportTool.tsx`. Before writing, open `src/app/(app)/admin/upload/page.tsx` and reuse its page-header markup/classes so the two admin tools look consistent. Full component:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface BrowseFile { id: string; name: string; mimeType: string; size: number }
interface BrowseFolder { id: string; name: string }
interface TreeNode extends BrowseFolder {
  loaded: boolean;
  expanded: boolean;
  folders: TreeNode[];
  files: BrowseFile[];
}
interface ClientOption { id: string; name: string }
interface ImportStatus {
  id: string;
  status: "pending" | "running" | "completed" | "completed_with_errors" | "error";
  totalFiles: number;
  copiedFiles: number;
  skippedFiles: number;
  errors: { fileName: string; path: string; message: string }[] | null;
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

export default function ImportTool() {
  const [link, setLink] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data: ClientOption[]) => setClients(data))
      .catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function browse(body: { link?: string; folderId?: string }) {
    const res = await fetch("/api/admin/import/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || "Browse failed");
    return data as { folder: BrowseFolder; folders: BrowseFolder[]; files: BrowseFile[] };
  }

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim() || resolving) return;
    setResolving(true);
    setResolveError(null);
    setRoot(null);
    setChecked(new Set());
    setImportStatus(null);
    try {
      const data = await browse({ link: link.trim() });
      setRoot({
        ...data.folder,
        loaded: true,
        expanded: true,
        folders: data.folders.map((f) => ({ ...f, loaded: false, expanded: false, folders: [], files: [] })),
        files: data.files,
      });
    } catch (err) {
      setResolveError((err as Error).message);
    } finally {
      setResolving(false);
    }
  }

  const toggleExpand = useCallback(async (node: TreeNode) => {
    if (!node.loaded) {
      try {
        const data = await browse({ folderId: node.id });
        node.folders = data.folders.map((f) => ({ ...f, loaded: false, expanded: false, folders: [], files: [] }));
        node.files = data.files;
        node.loaded = true;
      } catch {
        return; // leave collapsed; user can retry
      }
    }
    node.expanded = !node.expanded;
    setRoot((r) => (r ? { ...r } : r));
  }, []);

  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Collect top-level checked folders/files (nothing under a checked ancestor). */
  function collectSelection(node: TreeNode): { folders: BrowseFolder[]; files: { id: string; name: string }[] } {
    const folders: BrowseFolder[] = [];
    const files: { id: string; name: string }[] = [];
    function walk(n: TreeNode) {
      if (checked.has(n.id)) {
        folders.push({ id: n.id, name: n.name });
        return; // whole subtree included — don't descend
      }
      for (const f of n.files) if (checked.has(f.id)) files.push({ id: f.id, name: f.name });
      for (const sub of n.folders) walk(sub);
    }
    walk(node);
    return { folders, files };
  }

  async function handleCreateClient() {
    if (!newClientName.trim() || creatingClient) return;
    setCreatingClient(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newClientName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create client");
      setClients((c) => [...c, { id: data.id, name: data.name }].sort((a, b) => a.name.localeCompare(b.name)));
      setClientId(data.id);
      setNewClientName("");
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setCreatingClient(false);
    }
  }

  function startPolling(importId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/import/${importId}`);
        if (!res.ok) return;
        const data: ImportStatus = await res.json();
        setImportStatus(data);
        if (data.status !== "pending" && data.status !== "running" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {}
    }, 2000);
  }

  async function handleStart() {
    if (!root || !clientId || starting) return;
    const selection = collectSelection(root);
    if (selection.folders.length === 0 && selection.files.length === 0) {
      setStartError("Select at least one folder or file");
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          sourceFolderId: root.id,
          sourceFolderName: root.name,
          selection,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start import");
      setImportStatus({ id: data.id, status: "pending", totalFiles: 0, copiedFiles: 0, skippedFiles: 0, errors: null });
      startPolling(data.id);
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  function renderFolder(node: TreeNode, depth: number, ancestorChecked: boolean) {
    const isChecked = ancestorChecked || checked.has(node.id);
    return (
      <div key={node.id}>
        <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 20 }}>
          <input
            type="checkbox"
            checked={isChecked}
            disabled={ancestorChecked}
            onChange={() => toggleChecked(node.id)}
            className="accent-[#C60D60]"
            aria-label={`Select folder ${node.name}`}
          />
          <button
            type="button"
            onClick={() => toggleExpand(node)}
            className="flex items-center gap-1.5 text-sm text-neutral-200 hover:text-white"
          >
            <span className="text-xs text-neutral-500">{node.expanded ? "▾" : "▸"}</span>
            <span>📁 {node.name}</span>
          </button>
        </div>
        {node.expanded && (
          <>
            {node.folders.map((sub) => renderFolder(sub, depth + 1, isChecked))}
            {node.files.map((file) => {
              const fileChecked = isChecked || checked.has(file.id);
              return (
                <div key={file.id} className="flex items-center gap-2 py-0.5" style={{ paddingLeft: (depth + 1) * 20 }}>
                  <input
                    type="checkbox"
                    checked={fileChecked}
                    disabled={isChecked}
                    onChange={() => toggleChecked(file.id)}
                    className="accent-[#C60D60]"
                    aria-label={`Select file ${file.name}`}
                  />
                  <span className="text-sm text-neutral-400 truncate">
                    🎬 {file.name}
                    <span className="ml-2 text-xs text-neutral-600">{formatBytes(file.size)}</span>
                  </span>
                </div>
              );
            })}
            {node.loaded && node.folders.length === 0 && node.files.length === 0 && (
              <p className="text-xs text-neutral-600" style={{ paddingLeft: (depth + 1) * 20 }}>empty</p>
            )}
          </>
        )}
      </div>
    );
  }

  const running = importStatus && (importStatus.status === "pending" || importStatus.status === "running");

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-semibold text-white mb-1">Import from Drive</h1>
      <p className="text-sm text-neutral-400 mb-6">
        Paste a link to an external Google Drive folder that&apos;s been shared with us. Select what to
        import and it will be copied into a client folder, then ingested automatically.
      </p>

      <form onSubmit={handleResolve} className="flex gap-2 mb-4">
        <input
          type="text"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
          className="flex-1 rounded-md px-3 py-2 text-sm bg-[#1a1a1a] border border-[#2A2A2A] text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#C60D60]"
        />
        <button
          type="submit"
          disabled={resolving || !link.trim()}
          className="px-4 py-2 rounded-md text-sm font-medium bg-[#C60D60] text-white disabled:opacity-50"
        >
          {resolving ? "Opening…" : "Open"}
        </button>
      </form>
      {resolveError && <p className="text-sm text-red-400 mb-4">{resolveError}</p>}

      {root && (
        <>
          <div className="rounded-lg border border-[#2A2A2A] bg-[#141414] p-4 mb-4 max-h-96 overflow-y-auto">
            {renderFolder(root, 0, false)}
          </div>

          <div className="flex items-end gap-3 mb-4 flex-wrap">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Destination client</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="rounded-md px-3 py-2 text-sm bg-[#1a1a1a] border border-[#2A2A2A] text-white"
              >
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">…or create new</label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="New client name"
                  className="rounded-md px-3 py-2 text-sm bg-[#1a1a1a] border border-[#2A2A2A] text-white placeholder:text-neutral-600"
                />
              </div>
              <button
                type="button"
                onClick={handleCreateClient}
                disabled={creatingClient || !newClientName.trim()}
                className="px-3 py-2 rounded-md text-sm border border-[#2A2A2A] text-neutral-300 disabled:opacity-50"
              >
                {creatingClient ? "Creating…" : "Create"}
              </button>
            </div>
            <button
              type="button"
              onClick={handleStart}
              disabled={starting || !clientId || !!running}
              className="ml-auto px-5 py-2 rounded-md text-sm font-medium bg-[#C60D60] text-white disabled:opacity-50"
            >
              {starting ? "Starting…" : "Import selected"}
            </button>
          </div>
          {startError && <p className="text-sm text-red-400 mb-4">{startError}</p>}
        </>
      )}

      {importStatus && (
        <div className="rounded-lg border border-[#2A2A2A] bg-[#141414] p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-white">
              {running ? "Importing…" : importStatus.status === "completed" ? "Import complete" :
                importStatus.status === "completed_with_errors" ? "Import finished with errors" : "Import failed"}
            </p>
            <p className="text-xs text-neutral-400">
              {importStatus.copiedFiles} copied
              {importStatus.skippedFiles > 0 && ` · ${importStatus.skippedFiles} skipped (already present)`}
              {importStatus.totalFiles > 0 && ` · ${importStatus.totalFiles} total`}
            </p>
          </div>
          {importStatus.totalFiles > 0 && (
            <div className="h-1.5 rounded-full bg-[#2A2A2A] overflow-hidden mb-3">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  background: "#C60D60",
                  width: `${Math.min(100, ((importStatus.copiedFiles + importStatus.skippedFiles + (importStatus.errors?.length || 0)) / importStatus.totalFiles) * 100)}%`,
                }}
              />
            </div>
          )}
          {importStatus.errors && importStatus.errors.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {importStatus.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-400">
                  {e.path ? `${e.path}/` : ""}{e.fileName || "Import"}: {e.message}
                </p>
              ))}
            </div>
          )}
          {!running && importStatus.status !== "error" && (
            <p className="text-xs text-neutral-500 mt-2">
              Copied footage is being ingested — clips will appear under the client shortly.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

Adjust `ClientOption` handling if `/api/clients` returns extra fields (it returns `id`, `name`, `slug`, `displayName`, counts — extra fields are fine, TS just needs the two used).

- [ ] **Step 3: Add the sidebar link**

In `src/components/layout/Sidebar.tsx`, append to the `adminItems` array (after the "Manage Clients" entry, line 41):

```tsx
{
  href: "/admin/import",
  label: "Import from Drive",
  icon: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
},
```

- [ ] **Step 4: Verify compile, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean; build lists `/admin/import` in the route table.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/admin/import src/components/layout/Sidebar.tsx
git commit -m "feat: admin Import-from-Drive page with folder tree selection"
```

---

### Task 8: Full verification + manual end-to-end

**Files:** none new.

- [ ] **Step 1: Run the full check suite**

```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```

Expected: everything passes.

- [ ] **Step 2: Manual end-to-end (requires Google + DB env, e.g. dev against prod-like env or on the Unraid after deploy)**

1. Apply the migration (`npm run db:migrate` locally, or `docker exec app-app-1 npm run db:migrate` after deploy).
2. Create a test folder in a personal (non-app) Google account, put a small video + a subfolder with another video in it, share as "anyone with the link can view".
3. In the UI: paste the link → tree appears → check the root folder → pick a test client → Import selected.
4. Watch progress reach completed; verify in Drive that the client folder now contains the copied structure; verify the clips appear in FootageStore (post-import sync) and process to "ready".
5. Re-run the same import → everything reported as skipped, no duplicates in Drive.
6. Negative test: paste a link to a folder that is NOT shared → clear "share with the FootageStore account" error.

- [ ] **Step 3: Update CLAUDE.md Key Files section**

Add one line under Key Files in `CLAUDE.md`:

```markdown
- `src/app/(app)/admin/import/` + `worker/processors/importDrive.ts` — Drive import tool (copy footage from external shared folders into a client folder)
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note Drive import tool in CLAUDE.md key files"
```
