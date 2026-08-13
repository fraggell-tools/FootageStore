import { NextRequest, NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
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
 *
 * Auth strategy: try auth() first (browser sessions), then fall back to
 * manually decoding the session cookie from the Cookie header. The
 * Windows installer sends the JWT directly as a Cookie header and
 * PowerShell 5.1's Invoke-WebRequest does not throw on 4xx, so a silent
 * 401 would corrupt the download. The explicit decode ensures panel
 * installs work even when auth() can't resolve the request context.
 */
async function resolveSession(request: NextRequest): Promise<boolean> {
  // Primary: NextAuth session context (browser flows)
  const session = await auth();
  if (session) return true;

  // Installer fallback A: Authorization: Bearer <token>
  // PowerShell 5.1's Invoke-WebRequest silently drops Cookie headers (they
  // are handled specially by .NET's HTTP stack), so installer scripts send
  // the JWT as a Bearer token instead — a plain header that always goes through.
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer) {
    for (const cookieName of ["__Secure-authjs.session-token", "authjs.session-token"]) {
      try {
        const decoded = await decode({ token: bearer, secret: process.env.NEXTAUTH_SECRET!, salt: cookieName });
        if (decoded?.email || decoded?.sub) return true;
      } catch { /* try next salt */ }
    }
  }

  // Installer fallback B: Cookie header (kept for any clients that do send it)
  for (const cookieName of ["__Secure-authjs.session-token", "authjs.session-token"]) {
    const rawCookie = request.cookies.get(cookieName)?.value;
    if (!rawCookie) continue;
    try {
      const decoded = await decode({ token: rawCookie, secret: process.env.NEXTAUTH_SECRET!, salt: cookieName });
      if (decoded?.email || decoded?.sub) return true;
    } catch { /* try next name */ }
  }
  return false;
}

export async function GET(request: NextRequest) {
  const ok = await resolveSession(request);
  if (!ok) {
    console.warn("[panel/download] 401 – cookies:", [...request.cookies.getAll().map(c => c.name)]);
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
