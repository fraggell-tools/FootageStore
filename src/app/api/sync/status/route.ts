import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/**
 * GET /api/sync/status
 *
 * Returns sync status info available to any authenticated user.
 * canSync flag indicates whether the current user can trigger a sync.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_clips,
      MAX(created_at) AS last_clip_added_at,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END)::int AS processing,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS errors
    FROM clips
  `);

  const row = result.rows[0] as any;

  return NextResponse.json({
    totalClips: row.total_clips,
    lastClipAddedAt: row.last_clip_added_at,
    processing: row.processing,
    errors: row.errors,
    canSync: session.user.role === "admin",
  });
}
