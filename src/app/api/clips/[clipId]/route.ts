import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { getOriginalDir, getProcessedDir } from "@/lib/storage";
import { deleteFileFromDrive } from "@/lib/gdrive";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clipId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clipId } = await params;

  const [clip] = await db
    .select()
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);

  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  return NextResponse.json(clip);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clipId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clipId } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) {
    updates.name = body.name;
  }
  if (body.shotType !== undefined) {
    updates.shotType = body.shotType || null;
  }
  if (body.tags !== undefined) {
    updates.tags = Array.isArray(body.tags) ? body.tags : null;
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(clips)
    .set(updates)
    .where(eq(clips.id, clipId))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ clipId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clipId } = await params;

  const [clip] = await db
    .select()
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);

  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  // Delete files from disk
  const originalDir = getOriginalDir(clip.clientId, clipId);
  const processedDir = getProcessedDir(clipId);

  await Promise.allSettled([
    fs.rm(originalDir, { recursive: true, force: true }),
    fs.rm(processedDir, { recursive: true, force: true }),
    // Delete from Google Drive if it exists
    clip.driveFileId ? deleteFileFromDrive(clip.driveFileId) : Promise.resolve(),
  ]);

  await db.delete(clips).where(eq(clips.id, clipId));

  return NextResponse.json({ success: true });
}
