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
