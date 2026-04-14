import { db } from "@/lib/db";
import { clients, clips } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { listClientFolders, listFilesInFolder } from "@/lib/gdrive";
import { getClipQueue } from "@/lib/queue";

export interface SyncResult {
  clientsCreated: number;
  clientsRemoved: number;
  clipsCreated: number;
  clipsRemoved: number;
  errors: string[];
}

/**
 * Sync Google Drive state to the database.
 * - Folders in the parent become clients
 * - Video files in each folder become clips
 * - Missing folders/files get cleaned up from DB
 */
export async function syncFromDrive(): Promise<SyncResult> {
  const result: SyncResult = {
    clientsCreated: 0,
    clientsRemoved: 0,
    clipsCreated: 0,
    clipsRemoved: 0,
    errors: [],
  };

  try {
    // 1. Sync folders → clients
    const driveFolders = await listClientFolders();
    const driveFolderIds = new Set(driveFolders.map((f) => f.id));

    // Get existing clients from DB
    const existingClients = await db.select().from(clients);
    const existingByDriveId = new Map(
      existingClients
        .filter((c) => c.driveFolderId)
        .map((c) => [c.driveFolderId!, c])
    );

    // Create clients for new folders
    for (const folder of driveFolders) {
      if (!existingByDriveId.has(folder.id)) {
        const slug = folder.name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

        try {
          await db.insert(clients).values({
            name: folder.name,
            slug: slug || `client-${folder.id.slice(0, 8)}`,
            driveFolderId: folder.id,
          });
          result.clientsCreated++;
        } catch (err) {
          // Slug conflict — append a suffix
          try {
            await db.insert(clients).values({
              name: folder.name,
              slug: `${slug}-${folder.id.slice(0, 6)}`,
              driveFolderId: folder.id,
            });
            result.clientsCreated++;
          } catch (innerErr) {
            result.errors.push(`Failed to create client for folder "${folder.name}": ${(innerErr as Error).message}`);
          }
        }
      } else {
        // Update name if it changed in Drive
        const existing = existingByDriveId.get(folder.id)!;
        if (existing.name !== folder.name) {
          const slug = folder.name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          await db
            .update(clients)
            .set({ name: folder.name, slug: slug || existing.slug, updatedAt: new Date() })
            .where(eq(clients.id, existing.id));
        }
      }
    }

    // Remove clients whose Drive folders no longer exist
    for (const client of existingClients) {
      if (client.driveFolderId && !driveFolderIds.has(client.driveFolderId)) {
        await db.delete(clients).where(eq(clients.id, client.id));
        result.clientsRemoved++;
      }
    }

    // 2. Sync files → clips
    // Re-fetch clients after potential changes
    const allClients = await db.select().from(clients);

    for (const client of allClients) {
      if (!client.driveFolderId) continue;

      try {
        const driveFiles = await listFilesInFolder(client.driveFolderId);
        const driveFileIds = new Set(driveFiles.map((f) => f.id));

        // Get existing clips for this client
        const existingClips = await db
          .select()
          .from(clips)
          .where(eq(clips.clientId, client.id));

        const existingByDriveFileId = new Set(
          existingClips.filter((c) => c.driveFileId).map((c) => c.driveFileId!)
        );

        // Create clips for new files
        const queue = getClipQueue();
        for (const file of driveFiles) {
          if (!existingByDriveFileId.has(file.id)) {
            try {
              const clipId = crypto.randomUUID();
              await db.insert(clips).values({
                id: clipId,
                clientId: client.id,
                name: null,
                originalFilename: file.name,
                mimeType: file.mimeType || "video/mp4",
                fileSize: file.size || 0,
                status: "processing",
                originalPath: `gdrive://${file.id}`,
                driveFileId: file.id,
              });

              // Enqueue processing
              await queue.add("process-clip", { clipId }, { jobId: clipId });
              result.clipsCreated++;
            } catch (err) {
              result.errors.push(`Failed to create clip for "${file.name}": ${(err as Error).message}`);
            }
          }
        }

        // Remove clips whose Drive files no longer exist
        for (const clip of existingClips) {
          if (clip.driveFileId && !driveFileIds.has(clip.driveFileId)) {
            await db.delete(clips).where(eq(clips.id, clip.id));
            result.clipsRemoved++;
          }
        }
      } catch (err) {
        result.errors.push(`Failed to sync files for "${client.name}": ${(err as Error).message}`);
      }
    }
  } catch (err) {
    result.errors.push(`Sync failed: ${(err as Error).message}`);
  }

  return result;
}
