import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncFromDrive } from "@/lib/sync";

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await syncFromDrive();
  return NextResponse.json(result);
}
