import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

function getPublicUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) {
    return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
  }
  return req.url;
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Pass through public paths and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname === "/login" ||
    pathname === "/favicon.ico" ||
    pathname === "/panel-version.json" ||
    pathname === "/install-panel.sh" ||
    pathname === "/install-panel.bat" ||
    pathname === "/install-panel.ps1" ||
    pathname === "/api/panel/download" ||  // route handles its own auth via JWT decode
    // Server-to-server clip reads (the review app embedding footage clips in
    // review comments). These accept FOOTAGE_STORE_SERVICE_TOKEN and still fall
    // back to a session check, so skipping the SSO redirect here doesn't open
    // them up — without the redirect a service call gets a 307 to hub login
    // instead of its 401/200.
    pathname === "/api/clips/lookup" ||
    pathname === "/api/clips" ||
    pathname === "/api/clients" ||
    /^\/api\/clips\/[^/]+\/(proxy|download|thumbnail)$/.test(pathname) ||
    pathname.match(/\.(svg|png|jpg|ico|js|css|json|sh|bat|ps1|zip)$/)
  ) {
    return NextResponse.next();
  }

  // Check for existing NextAuth session (edge-compatible, no Node.js crypto)
  const isSecure = req.url.startsWith("https://");
  const cookieName = isSecure
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET!,
    cookieName,
    salt: cookieName,
  });
  if (token) return NextResponse.next();

  const publicUrl = getPublicUrl(req);

  // No session — check for hub_auth cookie
  const hubToken = req.cookies.get("hub_auth")?.value;
  if (hubToken) {
    const ssoUrl = new URL("/api/auth/hub-sso", publicUrl);
    ssoUrl.searchParams.set("callbackUrl", publicUrl);
    return NextResponse.redirect(ssoUrl);
  }

  // No hub token either — send to hub login
  return NextResponse.redirect(
    `https://hub.fraggell.com/login?redirectTo=${encodeURIComponent(publicUrl)}`
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
