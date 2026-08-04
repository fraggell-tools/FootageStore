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
