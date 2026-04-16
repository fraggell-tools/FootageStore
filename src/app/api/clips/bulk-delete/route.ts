import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import fs from "fs/promises";
import { getOriginalDir, getProcessedDir } from "@/lib/storage";
import { deleteFileFromDrive } from "@/lib/gdrive";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { clipIds } = body as { clipIds: string[] };

  if (!clipIds?.length) {
    return NextResponse.json({ error: "clipIds is required" }, { status: 400 });
  }

  // Fetch all clips to get file paths
  const clipsToDelete = await db
    .select()
    .from(clips)
    .where(inArray(clips.id, clipIds));

  // Delete files from disk + Drive in parallel (best-effort)
  const fileCleanups = clipsToDelete.flatMap((clip) => [
    fs.rm(getOriginalDir(clip.clientId, clip.id), { recursive: true, force: true }),
    fs.rm(getProcessedDir(clip.id), { recursive: true, force: true }),
    clip.driveFileId ? deleteFileFromDrive(clip.driveFileId) : Promise.resolve(),
  ]);
  await Promise.allSettled(fileCleanups);

  // Delete DB records
  await db.delete(clips).where(inArray(clips.id, clipIds));

  return NextResponse.json({ deleted: clipsToDelete.length });
}
