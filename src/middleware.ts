import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth"];

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Pass through public paths and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/login" ||
    pathname === "/favicon.ico" ||
    pathname.match(/\.(svg|png|jpg|ico|js|css)$/)
  ) {
    return NextResponse.next();
  }

  // Check for existing NextAuth session
  const session = await auth();
  if (session) return NextResponse.next();

  // No session — check for hub_auth cookie
  const hubToken = req.cookies.get("hub_auth")?.value;
  if (hubToken) {
    const ssoUrl = new URL("/api/auth/hub-sso", req.url);
    ssoUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(ssoUrl);
  }

  // No hub token either — send to hub login
  return NextResponse.redirect(
    `https://hub.fraggell.com/login?redirectTo=${encodeURIComponent(req.url)}`
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
