import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const REVIEW_BASE = process.env.REVIEW_BASE_URL || "https://review.fraggell.com";

// GET /api/concept-brief/search?q=<query> → handover-task candidates for the
// panel's manual brief picker (when the project name doesn't auto-match).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.REVIEW_SERVICE_TOKEN;
  if (!token) return NextResponse.json({ results: [] });

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  try {
    const res = await fetch(
      `${REVIEW_BASE}/api/concept-brief/search?q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json({ results: [] });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ results: [] });
  }
}
