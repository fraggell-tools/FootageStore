import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { clips, clients } from "../../src/lib/db/schema";
import {
  getProcessedDir,
  getOriginalDir,
  getThumbnailPath,
  getSpriteSheetPath,
  getWebVTTPath,
  ensureDir,
} from "../../src/lib/storage";
import { extractMetadata } from "./extractMetadata";
import { generateThumbnail } from "./generateThumbnail";
import { generateSpriteSheet } from "./generateSpriteSheet";
import { generateClipName } from "./generateClipName";
import { uploadFileToDrive } from "../../src/lib/gdrive";
import fs from "fs";
import fsPromises from "fs/promises";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

interface JobData {
  clipId: string;
}

export async function processClip(data: JobData): Promise<void> {
  const { clipId } = data;

  try {
    // 1. Read clip record from DB
    const [clip] = await db
      .select()
      .from(clips)
      .where(eq(clips.id, clipId))
      .limit(1);

    if (!clip) {
      throw new Error(`Clip not found: ${clipId}`);
    }

    // Update status to processing
    await db
      .update(clips)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(clips.id, clipId));

    // Ensure processed directory exists
    const processedDir = getProcessedDir(clipId);
    await ensureDir(processedDir);

    // If the file is on Google Drive, download it to a temp local path for FFmpeg
    let inputPath = clip.originalPath;
    let tempDownloaded = false;

    if (clip.driveFileId && clip.originalPath.startsWith("gdrive://")) {
      console.log(`[processClip] Downloading ${clipId} from Google Drive...`);
      const { downloadFileFromDrive } = await import("../../src/lib/gdrive");
      const ext = clip.originalFilename.match(/\.[^.]+$/)?.[0] || ".mp4";
      inputPath = `${processedDir}/temp_original${ext}`;
      const driveStream = await downloadFileFromDrive(clip.driveFileId);
      const writeStream = fs.createWriteStream(inputPath);
      await new Promise<void>((resolve, reject) => {
        driveStream.pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });
      tempDownloaded = true;
      console.log(`[processClip] Downloaded from Drive to ${inputPath}`);
    }

    // 2. Extract metadata
    console.log(`[processClip] Extracting metadata for ${clipId}`);
    const metadata = await extractMetadata(inputPath);
    await db
      .update(clips)
      .set({
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        codec: metadata.codec,
        fps: metadata.fps,
        updatedAt: new Date(),
      })
      .where(eq(clips.id, clipId));

    // 3. Generate thumbnail
    console.log(`[processClip] Generating thumbnail for ${clipId}`);
    const thumbnailPath = getThumbnailPath(clipId);
    await generateThumbnail(inputPath, thumbnailPath, metadata.duration);

    // 4. Generate sprite sheet + WebVTT
    console.log(`[processClip] Generating sprite sheet for ${clipId}`);
    const spritePath = getSpriteSheetPath(clipId);
    const vttPath = getWebVTTPath(clipId);
    await generateSpriteSheet(inputPath, spritePath, vttPath, metadata.duration, metadata.width, metadata.height);

    // 5. Generate AI scene analysis (name + description)
    console.log(`[processClip] Analyzing scene for ${clipId}`);
    let clipName: string;
    let clipDescription: string | null = null;
    let clipShotType: string | null = null;
    let clipTags: string[] | null = null;
    try {
      const analysis = await generateClipName(inputPath, metadata.duration, clipId);
      clipName = analysis.name;
      clipDescription = analysis.description;
      clipShotType = analysis.shotType;
      clipTags = analysis.tags;
    } catch (err) {
      console.warn(
        `[processClip] AI analysis failed for ${clipId}, using filename:`,
        (err as Error).message
      );
      clipName = clip.originalFilename.replace(/\.[^.]+$/, "");
    }

    // 6. Handle Drive upload / cleanup
    let driveFileId: string | null = clip.driveFileId || null;

    if (!driveFileId) {
      // File was uploaded via old local flow — upload to Drive now
      try {
        const [client] = await db
          .select({ driveFolderId: clients.driveFolderId })
          .from(clients)
          .where(eq(clients.id, clip.clientId))
          .limit(1);

        if (client?.driveFolderId) {
          console.log(`[processClip] Uploading ${clipId} to Google Drive...`);
          const fileStream = fs.createReadStream(inputPath);
          driveFileId = await uploadFileToDrive(
            client.driveFolderId,
            clip.originalFilename,
            clip.mimeType,
            fileStream
          );
          console.log(`[processClip] Uploaded to Drive: ${driveFileId}`);
        }
      } catch (driveErr) {
        console.error(`[processClip] Drive upload failed for ${clipId}:`, (driveErr as Error).message);
      }
    }

    // Clean up local original / temp file
    if (tempDownloaded) {
      await fsPromises.unlink(inputPath).catch(() => {});
    } else {
      const originalDir = getOriginalDir(clip.clientId, clipId);
      await fsPromises.rm(originalDir, { recursive: true, force: true }).catch(() => {});
    }

    // 7. Update clip to ready
    await db
      .update(clips)
      .set({
        name: clipName,
        description: clipDescription,
        shotType: clipShotType,
        tags: clipTags,
        thumbnailPath,
        spriteSheetPath: spritePath,
        webvttPath: vttPath,
        driveFileId,
        status: "ready",
        updatedAt: new Date(),
      })
      .where(eq(clips.id, clipId));

    console.log(`[processClip] Clip ${clipId} processing complete: "${clipName}"`);
  } catch (err) {
    console.error(
      `[processClip] Error processing clip ${clipId}:`,
      (err as Error).message
    );

    // Set status to error
    await db
      .update(clips)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(clips.id, clipId));

    throw err;
  }
}
