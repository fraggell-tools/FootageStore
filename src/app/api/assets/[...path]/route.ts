import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { stat, readFile } from "fs/promises";
import path from "path";
import { getDataDir } from "@/lib/storage";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getR2PresignedUrl } from "@/lib/r2";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".vtt": "text/vtt",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { path: segments } = await params;

  // Proxy videos live on R2, not on local disk. The panel requests them at
  // /api/assets/{clipId}/proxy.mp4 (HEAD to check existence, then GET as a blob).
  // Stream the R2 object through so the panel's existing preview code just works;
  // 404 while the proxy is still generating so the panel keeps polling.
  if (segments.length === 2 && segments[1] === "proxy.mp4") {
    const clipId = segments[0];
    const [clip] = await db
      .select({ proxyR2Key: clips.proxyR2Key, proxyStatus: clips.proxyStatus })
      .from(clips)
      .where(eq(clips.id, clipId))
      .limit(1);
    if (!clip || clip.proxyStatus !== "done" || !clip.proxyR2Key) {
      return NextResponse.json({ error: "Proxy not ready" }, { status: 404 });
    }
    const url = await getR2PresignedUrl(clip.proxyR2Key);
    if (!url) return NextResponse.json({ error: "Proxy unavailable" }, { status: 404 });
    const r2 = await fetch(url);
    if (!r2.ok || !r2.body) {
      return NextResponse.json({ error: "Proxy fetch failed" }, { status: 502 });
    }
    return new NextResponse(r2.body, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        ...(r2.headers.get("content-length")
          ? { "Content-Length": r2.headers.get("content-length")! }
          : {}),
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const filePath = path.join(getDataDir(), "processed", ...segments);

  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  const processedRoot = path.resolve(path.join(getDataDir(), "processed"));
  if (!resolved.startsWith(processedRoot)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await stat(resolved);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  const data = await readFile(resolved);

  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
