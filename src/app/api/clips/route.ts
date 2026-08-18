import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isServiceRequest } from "@/lib/service-auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { eq, ilike, sql, desc, asc, count, and, or, getTableColumns } from "drizzle-orm";

export async function GET(request: NextRequest) {
  if (!isServiceRequest(request)) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");
  const search = searchParams.get("search");
  const shotType = searchParams.get("shotType");
  // sort=oldest orders by upload date ascending; anything else (default) newest-first.
  const sort = searchParams.get("sort") === "oldest" ? "oldest" : "newest";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  const conditions = [eq(clips.clientId, clientId)];
  if (search) {
    // Search name, filename, month and angle so panel free-text finds all of them.
    const term = `%${search}%`;
    conditions.push(
      or(
        ilike(clips.name, term),
        ilike(clips.originalFilename, term),
        ilike(clips.month, term),
        ilike(clips.angle, term)
      )!
    );
  }
  if (shotType) {
    conditions.push(eq(clips.shotType, shotType));
  }

  const where = and(...conditions);

  // Bulk mode: every clip for the client in one response, with a slim column
  // set. The review app's clip browser mirrors this app's client-side filtering
  // (tags, month, angle, orientation, roll), which needs the whole set in the
  // browser rather than a page at a time.
  //
  // `description` is deliberately excluded: for the largest client it is 6.7 MB
  // across 6081 clips versus ~1 MB for everything else, so shipping it would
  // dominate the payload. Callers using this mode search the remaining fields.
  if (searchParams.get("all") === "1") {
    const rows = await db
      .select({
        id: clips.id,
        code: clips.code,
        name: clips.name,
        originalFilename: clips.originalFilename,
        duration: clips.duration,
        width: clips.width,
        height: clips.height,
        shotType: clips.shotType,
        month: clips.month,
        angle: clips.angle,
        tags: clips.tags,
        productSkus: clips.productSkus,
        hasSpeech: clips.hasSpeech,
        proxyStatus: clips.proxyStatus,
        createdAt: clips.createdAt,
      })
      .from(clips)
      .where(where)
      .orderBy(sort === "oldest" ? asc(clips.createdAt) : desc(clips.createdAt));

    return NextResponse.json({
      clips: rows,
      pagination: { page: 1, limit: rows.length, total: rows.length, totalPages: 1 },
    });
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(clips)
    .where(where);

  // Exclude the heavy `transcript` column from the list payload. It's only shown
  // in the detail modal (which re-fetches the full clip by id) and isn't used by
  // the grid, filters or search — shipping it for every clip (1000s per client,
  // multi-KB each) bloated these paginated responses. Everything else is kept.
  const { transcript: _transcript, ...listColumns } = getTableColumns(clips);

  const results = await db
    .select(listColumns)
    .from(clips)
    .where(where)
    .orderBy(sort === "oldest" ? asc(clips.createdAt) : desc(clips.createdAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({
    clips: results,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
