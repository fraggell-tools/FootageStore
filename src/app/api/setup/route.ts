import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashSync } from "bcryptjs";
import { count } from "drizzle-orm";

export async function POST(request: NextRequest) {
  // Only works when there are zero users in the database
  const [{ total }] = await db.select({ total: count() }).from(users);

  if (total > 0) {
    return NextResponse.json(
      { error: "Setup already complete. Use the admin panel to manage users." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { email, password, name } = body;

  if (!email || !password || !name) {
    return NextResponse.json(
      { error: "email, password, and name are required" },
      { status: 400 }
    );
  }

  const passwordHash = hashSync(password, 10);

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      name,
      role: "admin",
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    });

  return NextResponse.json(
    { message: "Admin account created successfully", user },
    { status: 201 }
  );
}

export async function GET() {
  const [{ total }] = await db.select({ total: count() }).from(users);

  return NextResponse.json({
    setupRequired: total === 0,
    message: total === 0
      ? "No users exist. POST to /api/setup with email, password, and name to create the first admin."
      : "Setup already complete.",
  });
}
