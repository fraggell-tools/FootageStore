import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// The review app owns concept-brief resolution (ClickUp handover tasks + Google
// Docs). We proxy so the service token never reaches the client-side Premiere
// panel — same pattern as the brand-kit proxy → Hub.
const REVIEW_BASE = process.env.REVIEW_BASE_URL || "https://review.fraggell.com";

// GET /api/concept-brief?project=<prproj name> → resolve the brief for the open
// Premiere project (auto-match). The panel is already authenticated to us.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.REVIEW_SERVICE_TOKEN;
  if (!token) return NextResponse.json({ matched: false });

  const project = (req.nextUrl.searchParams.get("project") || "").trim();
  if (!project) return NextResponse.json({ error: "project is required" }, { status: 400 });

  try {
    const res = await fetch(
      `${REVIEW_BASE}/api/concept-brief/resolve?name=${encodeURIComponent(project)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json({ matched: false });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ matched: false });
  }
}
