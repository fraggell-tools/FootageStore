import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isServiceRequest } from "@/lib/service-auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import path from "path";
import { getDataDir, getThumbnailPath } from "@/lib/storage";

/**
 * GET /api/clips/[clipId]/thumbnail
 *
 * Serves a clip's poster frame by clip id. The website reads thumbnails through
 * /api/assets/<thumbnailPath>, but that requires knowing the on-disk path, which
 * only the clip row exposes. Server-to-server callers (the review app, drawing
 * clip chips in comments) hold a code, not a path, so give them a route keyed on
 * the id and keep storage layout an internal detail.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipId: string }> }
) {
  if (!isServiceRequest(request)) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clipId } = await params;

  const [clip] = await db
    .select({ thumbnailPath: clips.thumbnailPath })
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);

  if (!clip?.thumbnailPath) {
    return NextResponse.json({ error: "No thumbnail" }, { status: 404 });
  }

  // Derive the path from the clip id rather than trusting the stored string,
  // so a bad thumbnail_path value can never read outside the processed dir.
  // Same layout the website's own thumbnails use (processed/<clipId>/thumbnail.jpg).
  const resolved = path.resolve(getThumbnailPath(clipId));
  const processedRoot = path.resolve(path.join(getDataDir(), "processed"));
  if (!resolved.startsWith(processedRoot)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const data = await readFile(resolved);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(data.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
