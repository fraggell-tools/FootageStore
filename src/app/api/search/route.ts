import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips, clients } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

  if (!query) {
    return NextResponse.json({ clips: [], query: "" });
  }

  // Use websearch_to_tsquery so users can type natural language like
  // "product on screen" without worrying about operators or stopwords.
  // It handles AND/OR/quoted phrases and gracefully ignores stopwords.

  const results = await db
    .select({
      id: clips.id,
      name: clips.name,
      description: clips.description,
      clientId: clips.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      duration: clips.duration,
      width: clips.width,
      height: clips.height,
      fileSize: clips.fileSize,
      codec: clips.codec,
      fps: clips.fps,
      originalFilename: clips.originalFilename,
      createdAt: clips.createdAt,
      status: clips.status,
      thumbnailPath: clips.thumbnailPath,
      spriteSheetPath: clips.spriteSheetPath,
      rank: sql<number>`ts_rank(
        to_tsvector('english',
          COALESCE(${clips.name}, '') || ' ' ||
          COALESCE(${clips.description}, '') || ' ' ||
          COALESCE(${clips.originalFilename}, '') || ' ' ||
          COALESCE(${clips.shotType}, '') || ' ' ||
          COALESCE(${clips.tags}::text, '') || ' ' ||
          COALESCE(${clips.productSkus}::text, '')
        ),
        websearch_to_tsquery('english', ${query})
      )`.as("rank"),
    })
    .from(clips)
    .innerJoin(clients, eq(clips.clientId, clients.id))
    .where(
      sql`to_tsvector('english',
        COALESCE(${clips.name}, '') || ' ' ||
        COALESCE(${clips.description}, '') || ' ' ||
        COALESCE(${clips.originalFilename}, '') || ' ' ||
        COALESCE(${clips.shotType}, '') || ' ' ||
        COALESCE(${clips.tags}::text, '') || ' ' ||
        COALESCE(${clips.productSkus}::text, '')
      ) @@ websearch_to_tsquery('english', ${query})`
    )
    .orderBy(sql`rank DESC`)
    .limit(limit);

  // Add computed/aliased fields for the frontend
  const clipsWithMeta = results.map((clip) => ({
    ...clip,
    fileSizeBytes: clip.fileSize,
    uploadedAt: clip.createdAt,
    hasThumbnail: !!clip.thumbnailPath,
    hasSpriteSheet: !!clip.spriteSheetPath,
  }));

  return NextResponse.json({ clips: clipsWithMeta, query });
}
