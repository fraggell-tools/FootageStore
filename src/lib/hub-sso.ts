import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createHmac } from "crypto";
import { encode } from "next-auth/jwt";

// Shared Hub-SSO logic used by both the browser SSO exchange (/api/auth/hub-sso)
// and the Premiere panel loopback bridge (/api/auth/panel-login). The Hub is the
// single source of truth for identity; we verify its signed cookie, map the role,
// auto-provision the local user, and mint our own NextAuth session.

// Hub roles → FootageStore roles. Unlisted roles are denied.
export const ROLE_MAP: Record<string, "admin" | "editor"> = {
  admin: "admin",
  editor: "editor",
  delivery: "editor",
  producer: "editor",
  creative_strategist: "editor",
  designer: "editor",
};

export type HubPayload = {
  sub: string;
  email: string;
  name: string;
  role: string;
  avatarUrl?: string;
};

/** Verify the Hub's HS256 `hub_auth` JWT with the shared secret. Throws on failure. */
export function verifyHubJwt(token: string): HubPayload {
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
  return payload as HubPayload;
}

/** The session-cookie name NextAuth uses, depending on scheme. */
export function sessionCookieName(isSecure: boolean): string {
  return isSecure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/**
 * Resolve a verified Hub payload to a local user (auto-provisioning on first
 * sight) and mint a NextAuth v5 session JWT. Returns null if the Hub role has no
 * FootageStore access. `maxAgeSeconds` controls the token lifetime.
 */
export async function mintSessionForHubPayload(
  hubPayload: HubPayload,
  isSecure: boolean,
  maxAgeSeconds: number
): Promise<{ token: string; role: "admin" | "editor" } | null> {
  const footageRole = ROLE_MAP[hubPayload.role];
  if (!footageRole) return null;

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

  const now = Math.floor(Date.now() / 1000);
  const token = await encode({
    token: {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      id: user.id,
      picture: hubPayload.avatarUrl || null,
      iat: now,
      exp: now + maxAgeSeconds,
    },
    secret: process.env.NEXTAUTH_SECRET!,
    salt: sessionCookieName(isSecure),
  });

  return { token, role: user.role };
}
