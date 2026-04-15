import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await params;
  const body = await request.json();
  const { email, name, role, password } = body;

  const updates: Record<string, unknown> = {};

  if (typeof email === "string" && email.trim()) updates.email = email.trim();
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof role === "string") {
    if (!["admin", "editor"].includes(role)) {
      return NextResponse.json({ error: "role must be admin or editor" }, { status: 400 });
    }
    updates.role = role;
  }
  if (typeof password === "string" && password.trim()) {
    updates.passwordHash = hashSync(password, 10);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no updates provided" }, { status: 400 });
  }

  // Prevent an admin from demoting themselves (would lock them out)
  if (updates.role && updates.role !== "admin" && userId === session.user.id) {
    return NextResponse.json(
      { error: "you can't change your own role" },
      { status: 400 }
    );
  }

  try {
    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
      });

    if (!updated) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    const msg = (err as Error).message || "update failed";
    // Drizzle surfaces unique constraint violations with this text
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "email already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await params;

  if (userId === session.user.id) {
    return NextResponse.json(
      { error: "you can't delete your own account" },
      { status: 400 }
    );
  }

  const [deleted] = await db
    .delete(users)
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  if (!deleted) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
