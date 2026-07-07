import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getR2PresignedUrl } from "@/lib/r2";

/**
 * GET /api/clips/[clipId]/proxy
 *
 * Redirects to a short-lived presigned URL for the clip's 480p preview proxy
 * on R2. If no proxy exists yet (still processing, failed, or R2 disabled), it
 * falls back to the original via the download route so the player always has
 * something to show.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clipId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clipId } = await params;

  const [clip] = await db
    .select({ proxyR2Key: clips.proxyR2Key, proxyStatus: clips.proxyStatus })
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);

  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  if (clip.proxyStatus === "done" && clip.proxyR2Key) {
    const url = await getR2PresignedUrl(clip.proxyR2Key);
    if (url) {
      return NextResponse.redirect(url, 302);
    }
  }

  // No proxy available — fall back to the original stream. Use a relative
  // Location header (valid per HTTP) so it resolves against the public URL
  // rather than the internal 0.0.0.0 address (documented middleware gotcha).
  return new NextResponse(null, {
    status: 302,
    headers: { Location: `/api/clips/${clipId}/download` },
  });
}
