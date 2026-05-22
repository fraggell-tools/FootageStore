import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips, clients } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/clips/lookup?code=K7M2QX
 *
 * Resolves a clip by its short, shareable code. Returns the clip together
 * with its client info, or 404 if no clip uses that code. This is the
 * integration point for both the website's global code lookup and the
 * Premiere plugin.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const code = new URL(request.url).searchParams
    .get("code")
    ?.trim()
    .toUpperCase();

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const [row] = await db
    .select({ clip: clips, client: clients })
    .from(clips)
    .innerJoin(clients, eq(clips.clientId, clients.id))
    .where(eq(clips.code, code))
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { error: "No clip found with that code" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    clip: {
      ...row.clip,
      clientName: row.client.name,
      clientSlug: row.client.slug,
      hasThumbnail: !!row.clip.thumbnailPath,
      hasSpriteSheet: !!row.clip.spriteSheetPath,
      fileSizeBytes: row.clip.fileSize,
      uploadedAt: row.clip.createdAt,
    },
  });
}
