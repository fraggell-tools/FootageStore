import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { generateUniqueClipCode } from "@/lib/clipCode";
import { getOriginalPath, ensureDir, getOriginalDir } from "@/lib/storage";
import { getClipQueue } from "@/lib/queue";
import { createWriteStream } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Writable } from "stream";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const clientId = formData.get("clientId") as string | null;
  const name = formData.get("name") as string | null;

  if (!file) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  const clipId = randomUUID();
  const ext = path.extname(file.name) || ".mp4";
  const originalPath = getOriginalPath(clientId, clipId, ext);

  // Ensure the directory exists
  await ensureDir(getOriginalDir(clientId, clipId));

  // Stream the file to disk instead of loading into memory
  const fileStream = file.stream();
  const writeStream = createWriteStream(originalPath);

  await new Promise<void>((resolve, reject) => {
    const reader = fileStream.getReader();
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        writeStream.write(chunk, callback);
      },
    });

    function pump(): void {
      reader.read().then(({ done, value }) => {
        if (done) {
          writeStream.end();
          resolve();
          return;
        }
        if (!writable.write(value)) {
          writable.once("drain", pump);
        } else {
          pump();
        }
      }).catch(reject);
    }

    writeStream.on("error", reject);
    pump();
  });

  // Create clip record
  const [clip] = await db
    .insert(clips)
    .values({
      id: clipId,
      code: await generateUniqueClipCode(),
      clientId,
      name: name || null,
      originalFilename: file.name,
      mimeType: file.type || "video/mp4",
      fileSize: file.size,
      status: "processing",
      originalPath,
      uploadedBy: session.user.id,
    })
    .returning();

  // Enqueue processing job
  const queue = getClipQueue();
  await queue.add("process-clip", { clipId }, { jobId: clipId });

  return NextResponse.json(clip, { status: 201 });
}
