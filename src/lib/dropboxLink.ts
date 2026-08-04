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
