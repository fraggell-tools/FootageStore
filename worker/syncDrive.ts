/**
 * Periodic Google Drive sync.
 * Scans the Drive parent folder for new/removed folders and files,
 * reconciles with the database, and enqueues processing for new clips.
 *
 * Runs alongside the worker process.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { clients, clips } from "../src/lib/db/schema";
import { listClientFolders, listFilesInFolder } from "../src/lib/gdrive";
import { Queue } from "bullmq";
import { createRedisConnection } from "../src/lib/redis";
import { randomUUID } from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const SYNC_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

async function sync() {
  console.log(`[Sync] Starting Drive sync...`);

  try {
    // 1. Sync folders → clients
    const driveFolders = await listClientFolders();
    const driveFolderIds = new Set(driveFolders.map((f) => f.id));

    const existingClients = await db.select().from(clients);
    const existingByDriveId = new Map(
      existingClients
        .filter((c) => c.driveFolderId)
        .map((c) => [c.driveFolderId!, c])
    );

    let clientsCreated = 0;
    let clientsRemoved = 0;
    let clipsCreated = 0;
    let clipsRemoved = 0;

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
          clientsCreated++;
          console.log(`[Sync] Created client: ${folder.name}`);
        } catch {
          try {
            await db.insert(clients).values({
              name: folder.name,
              slug: `${slug}-${folder.id.slice(0, 6)}`,
              driveFolderId: folder.id,
            });
            clientsCreated++;
          } catch (err) {
            console.error(`[Sync] Failed to create client "${folder.name}":`, (err as Error).message);
          }
        }
      } else {
        // Update name if changed
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
          console.log(`[Sync] Renamed client: ${existing.name} → ${folder.name}`);
        }
      }
    }

    // Remove clients whose Drive folders no longer exist
    for (const client of existingClients) {
      if (client.driveFolderId && !driveFolderIds.has(client.driveFolderId)) {
        await db.delete(clients).where(eq(clients.id, client.id));
        clientsRemoved++;
        console.log(`[Sync] Removed client: ${client.name}`);
      }
    }

    // 2. Sync files → clips
    const allClients = await db.select().from(clients);
    const queue = new Queue("clip-processing", { connection: createRedisConnection() });

    for (const client of allClients) {
      if (!client.driveFolderId) continue;

      try {
        const driveFiles = await listFilesInFolder(client.driveFolderId);
        const driveFileIds = new Set(driveFiles.map((f) => f.id));

        const existingClips = await db
          .select()
          .from(clips)
          .where(eq(clips.clientId, client.id));

        const existingByDriveFileId = new Set(
          existingClips.filter((c) => c.driveFileId).map((c) => c.driveFileId!)
        );

        // Create clips for new files
        for (const file of driveFiles) {
          if (!existingByDriveFileId.has(file.id)) {
            const clipId = randomUUID();
            try {
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
              await queue.add("process-clip", { clipId }, { jobId: clipId });
              clipsCreated++;
              console.log(`[Sync] New clip: ${file.name} (${client.name})`);
            } catch (err) {
              console.error(`[Sync] Failed to create clip "${file.name}":`, (err as Error).message);
            }
          }
        }

        // Remove clips whose Drive files no longer exist
        for (const clip of existingClips) {
          if (clip.driveFileId && !driveFileIds.has(clip.driveFileId)) {
            await db.delete(clips).where(eq(clips.id, clip.id));
            clipsRemoved++;
            console.log(`[Sync] Removed clip: ${clip.originalFilename}`);
          }
        }
      } catch (err) {
        console.error(`[Sync] Error syncing "${client.name}":`, (err as Error).message);
      }
    }

    await queue.close();

    console.log(
      `[Sync] Done — clients: +${clientsCreated}/-${clientsRemoved}, clips: +${clipsCreated}/-${clipsRemoved}`
    );
  } catch (err) {
    console.error("[Sync] Sync failed:", (err as Error).message);
  }
}

// Run immediately on start, then every 3 minutes
sync();
setInterval(sync, SYNC_INTERVAL_MS);

console.log(`[Sync] Drive sync running every ${SYNC_INTERVAL_MS / 1000}s`);
