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
  getSharedLinkMeta,
  listSharedLinkFolder,
  downloadSharedLinkFile,
  withDropboxRetry,
  isRetryableDropboxError,
  DropboxApiError,
} from "../../src/lib/dropbox";
import { isRetryableDriveError } from "./driveRetry";
import { buildCopyPlan, type CopyPlanEntry } from "./importPlan";
import { ensureFolderPath, getExistingNames } from "./importShared";

/** Retryable during the download+upload transfer loop: either a transient
 * Dropbox error on the download, or a transient Drive error on the upload. */
function isRetryableTransferError(err: unknown): boolean {
  return isRetryableDropboxError(err) || isRetryableDriveError(err);
}

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

    // Single-file (/scl/fi/) links collapse to id "" for BOTH the browse
    // root node and the lone file within it, because the shared-link tree
    // has no folder to distinguish them. The page's collectSelection walks
    // top-down and checks the root first, so a single-file selection always
    // comes back as folders:[{id:""}], never files:[{id:""}]. Feeding that
    // into buildCopyPlan would call listSharedLinkFolder(link, "") — i.e.
    // files/list_folder — on a link that Dropbox considers a file, which
    // 409s. Detect that case up front via the link's own metadata and build
    // a single-entry plan instead of going through buildCopyPlan.
    let plan: CopyPlanEntry[];
    const meta = await withDropboxRetry(() => getSharedLinkMeta(link));
    if (!meta.isFolder) {
      // downloadSharedLinkFile omits the `path` arg entirely for file links
      // when passed "", which is exactly what this needs.
      plan = [{ sourceFileId: "", fileName: meta.name, relativePath: [] }];
    } else {
      plan = await buildCopyPlan(imp.selection, (path) =>
        withDropboxRetry(() => listSharedLinkFolder(link, path))
      );
    }

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
          // fresh stream, so the upload can't be retried independently. The
          // predicate covers both APIs since a transient Drive 429/5xx from
          // uploadFileToDrive must also be retried, not just Dropbox errors.
          await withDropboxRetry(
            async () => {
              const { stream } = await downloadSharedLinkFile(link, entry.sourceFileId);
              try {
                await uploadFileToDrive(destFolderId, entry.fileName, "application/octet-stream", stream);
              } finally {
                // Always release the download stream (socket + buffers),
                // whether the upload succeeded or threw — otherwise a failed
                // upload leaks it for the life of this long-running worker.
                stream.destroy();
              }
            },
            { isRetryable: isRetryableTransferError }
          );
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
