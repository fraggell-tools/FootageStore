import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { generateUniqueClipCode } from "@/lib/clipCode";
import { getClipQueue } from "@/lib/queue";
import { randomUUID } from "crypto";

/**
 * POST /api/upload/complete
 * Called after the browser finishes uploading directly to Google Drive.
 * Creates the clip record and enqueues processing.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { clientId, driveFileId, fileName, fileSize, mimeType } = body;

  if (!clientId || !driveFileId || !fileName) {
    return NextResponse.json(
      { error: "clientId, driveFileId, and fileName are required" },
      { status: 400 }
    );
  }

  const clipId = randomUUID();

  // Create clip record — no local originalPath since file is on Drive
  const [clip] = await db
    .insert(clips)
    .values({
      id: clipId,
      code: await generateUniqueClipCode(),
      clientId,
      name: null,
      originalFilename: fileName,
      mimeType: mimeType || "video/mp4",
      fileSize: fileSize || 0,
      status: "processing",
      originalPath: `gdrive://${driveFileId}`,
      driveFileId,
      uploadedBy: session.user.id,
    })
    .returning();

  // Enqueue processing job
  const queue = getClipQueue();
  await queue.add("process-clip", { clipId }, { jobId: clipId });

  return NextResponse.json(clip, { status: 201 });
}
