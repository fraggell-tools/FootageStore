import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * GET /api/panel/download
 *
 * Authenticated endpoint that serves the Fraggell Footage Panel zip.
 * Requires a valid FootageStore session — editors must sign in before
 * the install script can download the panel.
 *
 * panel.zip lives at /data/panel/panel.zip (outside /public so it is
 * never accessible without auth).
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const zipPath = join(process.env.DATA_DIR || "/data", "panel", "panel.zip");

  try {
    const fileBuffer = readFileSync(zipPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=fraggell-footage-panel.zip",
        "Content-Length": String(fileBuffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Panel download failed:", e);
    return NextResponse.json({ error: "Panel not found" }, { status: 404 });
  }
}
