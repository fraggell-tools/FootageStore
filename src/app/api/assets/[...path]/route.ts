import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { stat, readFile } from "fs/promises";
import path from "path";
import { getDataDir } from "@/lib/storage";

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
