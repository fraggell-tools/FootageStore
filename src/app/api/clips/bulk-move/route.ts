import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips, clients } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { getOriginalDir } from "@/lib/storage";
import { moveFileToFolder } from "@/lib/gdrive";

/**
 * POST /api/clips/bulk-move
 * Move selected clips to another client — reassigns them in the DB AND moves the
 * underlying files into the target client's Google Drive folder.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clipIds, targetClientId } = (await request.json()) as {
    clipIds: string[];
    targetClientId: string;
  };
  if (!clipIds?.length || !targetClientId) {
    return NextResponse.json({ error: "clipIds and targetClientId are required" }, { status: 400 });
  }

  const [targetClient] = await db.select().from(clients).where(eq(clients.id, targetClientId));
  if (!targetClient) {
    return NextResponse.json({ error: "Target client not found" }, { status: 404 });
  }
  if (!targetClient.driveFolderId) {
    return NextResponse.json(
      { error: "Target client has no Google Drive folder to move files into" },
      { status: 400 }
    );
  }

  const toMove = await db.select().from(clips).where(inArray(clips.id, clipIds));

  let moved = 0;
  const failures: { clipId: string; filename: string; error: string }[] = [];

  for (const clip of toMove) {
    if (clip.clientId === targetClientId) {
      moved++; // already in the target client
      continue;
    }
    try {
      // 1. Move the file in Google Drive (file id is stable — only the parent changes).
      if (clip.driveFileId) {
        await moveFileToFolder(clip.driveFileId, targetClient.driveFolderId);
      }
      // 2. Relocate any on-disk original (best-effort; most clips stream from Drive and have none).
      try {
        const dest = getOriginalDir(targetClientId, clip.id);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.rename(getOriginalDir(clip.clientId, clip.id), dest);
      } catch {
        // no local original to move — fine
      }
      // 3. Reassign the clip. Done after the Drive move so that if the move fails the
      //    clip stays consistent with its current location; and if this update fails
      //    after a successful move, the move-aware Drive sync reconciles it.
      await db
        .update(clips)
        .set({ clientId: targetClientId, updatedAt: new Date() })
        .where(eq(clips.id, clip.id));
      moved++;
    } catch (err) {
      failures.push({
        clipId: clip.id,
        filename: clip.originalFilename,
        error: (err as Error).message,
      });
      console.error(`[bulk-move] Failed to move clip ${clip.id}:`, (err as Error).message);
    }
  }

  return NextResponse.json({
    moved,
    failed: failures.length,
    failures,
    targetClient: { id: targetClient.id, name: targetClient.name },
  });
}
