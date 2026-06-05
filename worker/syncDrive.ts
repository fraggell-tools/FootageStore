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
import { generateUniqueClipCode } from "../src/lib/clipCode";
import { listClientFolders, listFilesInFolder, type DriveFile } from "../src/lib/gdrive";
import { Queue } from "bullmq";
import { createRedisConnection } from "../src/lib/redis";
import { HEALTH_KEYS } from "../src/lib/health";
import { randomUUID } from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Dedicated connection for publishing sync health signals read by /api/health.
const healthRedis = createRedisConnection();

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
    let clipsMoved = 0;
    let clipInsertFailures = 0;
    let lastInsertError = "";

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

    // 2. Sync files → clips, reconciled GLOBALLY so a file moved between client
    //    folders (via the in-app "move to client" action, or by hand in Drive) is
    //    REASSIGNED to the new client rather than deleted from one and recreated in
    //    the other — which would throw away its code, AI analysis, tags and history.
    const allClients = await db.select().from(clients);
    const queue = new Queue("clip-processing", { connection: createRedisConnection() });

    // Map every Drive file currently under any client folder → the client it's in.
    // If a folder fails to list, the error propagates to the outer catch and we skip
    // reconciliation this cycle rather than delete clips on a partial view of Drive.
    const driveFileToClient = new Map<string, { clientId: string; file: DriveFile }>();
    for (const client of allClients) {
      if (!client.driveFolderId) continue;
      const driveFiles = await listFilesInFolder(client.driveFolderId);
      for (const file of driveFiles) {
        driveFileToClient.set(file.id, { clientId: client.id, file });
      }
    }

    const existingClips = await db
      .select({ id: clips.id, clientId: clips.clientId, driveFileId: clips.driveFileId })
      .from(clips);
    const clipByDriveFileId = new Map(
      existingClips.filter((c) => c.driveFileId).map((c) => [c.driveFileId!, c])
    );

    // Create clips for new files; reassign clips whose file now lives under a
    // different client's folder.
    for (const [fileId, { clientId, file }] of driveFileToClient) {
      const existing = clipByDriveFileId.get(fileId);
      if (!existing) {
        const clipId = randomUUID();
        try {
          await db.insert(clips).values({
            id: clipId,
            code: await generateUniqueClipCode(),
            clientId,
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
          console.log(`[Sync] New clip: ${file.name}`);
        } catch (err) {
          clipInsertFailures++;
          lastInsertError = (err as Error).message;
          console.error(`[Sync] Failed to create clip "${file.name}":`, (err as Error).message);
        }
      } else if (existing.clientId !== clientId) {
        await db
          .update(clips)
          .set({ clientId, updatedAt: new Date() })
          .where(eq(clips.id, existing.id));
        clipsMoved++;
        console.log(`[Sync] Reassigned clip ${existing.id} to its new client folder`);
      }
    }

    // Remove clips whose Drive file is gone from every client folder (truly deleted).
    for (const clip of existingClips) {
      if (clip.driveFileId && !driveFileToClient.has(clip.driveFileId)) {
        await db.delete(clips).where(eq(clips.id, clip.id));
        clipsRemoved++;
      }
    }

    await queue.close();

    console.log(
      `[Sync] Done — clients: +${clientsCreated}/-${clientsRemoved}, clips: +${clipsCreated}/-${clipsRemoved}, reassigned: ${clipsMoved}`
    );

    // Publish health signals for /api/health (read by the Fraggell Monitor).
    // insertFailuresLastRun resets to 0 on a clean run, so a recovered sync self-heals.
    await healthRedis.set(HEALTH_KEYS.syncLastRunAt, Date.now().toString());
    await healthRedis.set(HEALTH_KEYS.syncFailuresLastRun, clipInsertFailures.toString());
    if (clipInsertFailures > 0) {
      await healthRedis.set(HEALTH_KEYS.syncLastError, lastInsertError.slice(0, 300));
    }
  } catch (err) {
    console.error("[Sync] Sync failed:", (err as Error).message);
  }
}

// Run immediately on start, then every 3 minutes
sync();
setInterval(sync, SYNC_INTERVAL_MS);

console.log(`[Sync] Drive sync running every ${SYNC_INTERVAL_MS / 1000}s`);
