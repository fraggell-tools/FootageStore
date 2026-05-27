import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { compareSync } from "bcryptjs";
import { encode } from "@auth/core/jwt";

const PLUGIN_KEY = process.env.PLUGIN_API_KEY ?? "fraggell-premiere-plugin-2026";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, pluginKey } = body;

    // Shared plugin key prevents public credential brute-forcing via this endpoint
    if (pluginKey !== PLUGIN_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    // Verify credentials against DB (same logic as auth.ts authorize)
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    if (!compareSync(password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // Create an Auth.js-compatible JWE session token
    const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
    const sessionToken = await encode({
      token: {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        id: user.id,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      },
      secret,
      salt: "__Secure-authjs.session-token",
    });

    return NextResponse.json({
      sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[plugin-auth] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
