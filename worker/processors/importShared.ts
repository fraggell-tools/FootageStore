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
