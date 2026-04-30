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
  return payload as { sub: string; email: string; name: string; role: string };
}

export async function GET(req: NextRequest) {
  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") || "/clients";
  const hubLoginUrl = `https://hub.fraggell.com/login?redirectTo=${encodeURIComponent(
    new URL(callbackUrl, req.url).toString()
  )}`;

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
        passwordHash: `sso:${hubPayload.sub}`, // not a valid bcrypt hash — SSO users can't use password login
      })
      .returning();
  }

  // Mint a NextAuth v5 session JWT
  const sessionToken = await encode({
    token: {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      id: user.id,
    },
    secret: process.env.NEXTAUTH_SECRET!,
  });

  const isSecure = req.url.startsWith("https://");
  const cookieName = isSecure
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  const response = NextResponse.redirect(new URL(callbackUrl, req.url));
  response.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours, matches hub token expiry
  });

  return response;
}
