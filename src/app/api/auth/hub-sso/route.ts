import { NextRequest, NextResponse } from "next/server";
import {
  verifyHubJwt,
  mintSessionForHubPayload,
  sessionCookieName,
} from "@/lib/hub-sso";

const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

function getPublicBase(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export async function GET(req: NextRequest) {
  const publicBase = getPublicBase(req);
  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") || `${publicBase}/clients`;
  const hubLoginUrl = `https://hub.fraggell.com/login?redirectTo=${encodeURIComponent(callbackUrl)}`;

  const hubToken = req.cookies.get("hub_auth")?.value;
  if (!hubToken) return NextResponse.redirect(hubLoginUrl);

  let hubPayload;
  try {
    hubPayload = verifyHubJwt(hubToken);
  } catch {
    return NextResponse.redirect(hubLoginUrl);
  }

  const isSecure = req.url.startsWith("https://");
  const minted = await mintSessionForHubPayload(hubPayload, isSecure, SESSION_MAX_AGE);
  if (!minted) {
    return new NextResponse(
      "Access denied — your hub role does not have access to Footage Store.",
      { status: 403 }
    );
  }

  const cookieName = sessionCookieName(isSecure);
  const response = NextResponse.redirect(callbackUrl);
  response.cookies.set(cookieName, minted.token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return response;
}
