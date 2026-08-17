import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isServiceRequest } from "@/lib/service-auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import { stat } from "fs/promises";
import { downloadFileFromDrive, getDriveFileSize } from "@/lib/gdrive";

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
    .select()
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);

  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": clip.mimeType,
    "Content-Disposition": `attachment; filename="${encodeURIComponent(clip.originalFilename)}"`,
    "Accept-Ranges": "bytes",
  };

  // If the file is on Google Drive, stream from there
  if (clip.driveFileId) {
    try {
      const fileSize = await getDriveFileSize(clip.driveFileId);
      const stream = await downloadFileFromDrive(clip.driveFileId);

      return new NextResponse(stream as unknown as ReadableStream, {
        status: 200,
        headers: {
          ...headers,
          "Content-Length": String(fileSize),
        },
      });
    } catch (err) {
      console.error("Failed to download from Google Drive:", err);
      // Fall through to try local file
    }
  }

  // Fallback: serve from local filesystem
  const filePath = clip.originalPath;

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const fileSize = fileStat.size;
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return new NextResponse("Invalid range", { status: 416 });
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      return new NextResponse("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": String(chunkSize),
      },
    });
  }

  const stream = fs.createReadStream(filePath);

  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      ...headers,
      "Content-Length": String(fileSize),
    },
  });
}
