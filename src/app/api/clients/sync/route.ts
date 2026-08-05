import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncClientFolders } from "@/lib/sync";

/**
 * POST /api/clients/sync
 * On-demand folder→client discovery, so a folder someone just created directly
 * in Google Drive shows up as a client immediately (instead of after the worker's
 * ~3-minute sync cycle). Fast: folders only, no per-folder file scan.
 */
export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncClientFolders();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[clients/sync] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
