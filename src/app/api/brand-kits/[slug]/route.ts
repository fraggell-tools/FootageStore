import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const HUB_BASE = process.env.HUB_BASE_URL || "https://hub.fraggell.com";

// Proxy a single client's brand kit from the Hub, injecting the service token
// server-side. Returns the Hub payload verbatim (or 404 if no kit exists).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.SOP_SERVICE_TOKEN;
  if (!token) return NextResponse.json({ error: "Brand kits not configured" }, { status: 404 });

  const { slug } = await params;
  try {
    const res = await fetch(`${HUB_BASE}/api/brand-kits/${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 404) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!res.ok) return NextResponse.json({ error: "Hub error" }, { status: 502 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Hub unreachable" }, { status: 502 });
  }
}
