import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { clipIds, action, value } = body as {
    clipIds: string[];
    action: "addTags" | "addSkus" | "setShotType" | "removeTags" | "removeSkus";
    value: string[] | string;
  };

  if (!clipIds?.length || !action) {
    return NextResponse.json({ error: "clipIds and action are required" }, { status: 400 });
  }

  // Fetch current clips
  const currentClips = await db
    .select()
    .from(clips)
    .where(inArray(clips.id, clipIds));

  const updatedClips = [];

  if (action === "addTags" && Array.isArray(value)) {
    for (const clip of currentClips) {
      const existingTags = (clip.tags as string[]) || [];
      const merged = Array.from(new Set([...existingTags, ...value]));
      const [updated] = await db
        .update(clips)
        .set({ tags: merged, updatedAt: new Date() })
        .where(eq(clips.id, clip.id))
        .returning();
      updatedClips.push(updated);
    }
  } else if (action === "addSkus" && Array.isArray(value)) {
    for (const clip of currentClips) {
      const existingSkus = (clip.productSkus as string[]) || [];
      const merged = Array.from(new Set([...existingSkus, ...value]));
      const [updated] = await db
        .update(clips)
        .set({ productSkus: merged, updatedAt: new Date() })
        .where(eq(clips.id, clip.id))
        .returning();
      updatedClips.push(updated);
    }
  } else if (action === "removeTags" && Array.isArray(value)) {
    const toRemove = new Set(value);
    for (const clip of currentClips) {
      const existingTags = (clip.tags as string[]) || [];
      const filtered = existingTags.filter((t) => !toRemove.has(t));
      const [updated] = await db
        .update(clips)
        .set({ tags: filtered, updatedAt: new Date() })
        .where(eq(clips.id, clip.id))
        .returning();
      updatedClips.push(updated);
    }
  } else if (action === "removeSkus" && Array.isArray(value)) {
    const toRemove = new Set(value);
    for (const clip of currentClips) {
      const existingSkus = (clip.productSkus as string[]) || [];
      const filtered = existingSkus.filter((s) => !toRemove.has(s));
      const [updated] = await db
        .update(clips)
        .set({ productSkus: filtered, updatedAt: new Date() })
        .where(eq(clips.id, clip.id))
        .returning();
      updatedClips.push(updated);
    }
  } else if (action === "setShotType" && typeof value === "string") {
    const results = await db
      .update(clips)
      .set({ shotType: value || null, updatedAt: new Date() })
      .where(inArray(clips.id, clipIds))
      .returning();
    updatedClips.push(...results);
  } else {
    return NextResponse.json({ error: "Invalid action or value" }, { status: 400 });
  }

  return NextResponse.json({ updatedClips });
}
