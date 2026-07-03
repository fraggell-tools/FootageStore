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

    // Ingest immediately instead of waiting for the next periodic sync pass.
    // Lazy import: syncDrive self-starts its interval on first load, and the
    // worker has already loaded it by the time any job runs.
    try {
      const { runDriveSync } = await import("../syncDrive");
      await runDriveSync();
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
