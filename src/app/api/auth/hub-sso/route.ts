import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createHmac } from "crypto";
import { encode } from "next-auth/jwt";

// Hub roles → FootageStore roles. Unlisted roles are denied.
const ROLE_MAP: Record<string, "admin" | "editor"> = {
  admin: "admin",
  editor: "editor",
  delivery: "editor",
  producer: "editor",
  creative_strategist: "editor",
};

function getPublicBase(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

function verifyHubJwt(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [headerB64, payloadB64, sigB64] = parts;

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");

  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  if (expected !== sigB64) throw new Error("Invalid signature");

  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  return payload as { sub: string; email: string; name: string; role: string; avatarUrl?: string };
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

  const footageRole = ROLE_MAP[hubPayload.role];
  if (!footageRole) {
    return new NextResponse(
      "Access denied — your hub role does not have access to Footage Store.",
      { status: 403 }
    );
  }

  // Look up existing user or auto-provision from hub
  let [user] = await db.select().from(users).where(eq(users.email, hubPayload.email)).limit(1);

  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        email: hubPayload.email,
        name: hubPayload.name,
        role: footageRole,
        passwordHash: `sso:${hubPayload.sub}`,
      })
      .returning();
  }

  const isSecure = req.url.startsWith("https://");
  const cookieName = isSecure
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  // Mint a NextAuth v5 session JWT
  const sessionToken = await encode({
    token: {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      id: user.id,
      picture: hubPayload.avatarUrl || null,
    },
    secret: process.env.NEXTAUTH_SECRET!,
    salt: cookieName,
  });

  const response = NextResponse.redirect(callbackUrl);
  response.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}
