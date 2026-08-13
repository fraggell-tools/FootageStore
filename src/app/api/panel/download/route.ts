import { NextRequest, NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import { auth } from "@/lib/auth";
import { sessionCookieName } from "@/lib/hub-sso";
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

  // Fallback: decode the JWT directly from the Cookie header
  // (used by the Windows/Mac installer scripts).
  // Use x-forwarded-proto to determine the scheme — request.url is the
  // internal http:// URL from the compose network, not the public HTTPS one.
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const isSecure = proto === "https";
  const cookieName = sessionCookieName(isSecure);
  const rawCookie = request.cookies.get(cookieName)?.value;
  if (!rawCookie) return false;

  try {
    const decoded = await decode({
      token: rawCookie,
      secret: process.env.NEXTAUTH_SECRET!,
      salt: cookieName,
    });
    return !!(decoded?.email || decoded?.sub);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const ok = await resolveSession(request);
  if (!ok) {
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
