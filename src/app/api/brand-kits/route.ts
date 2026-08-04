import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Hub holds the brand-kit data; we proxy so the service token never reaches the
// client-side Premiere panel. The panel is already authenticated to FootageStore.
const HUB_BASE = process.env.HUB_BASE_URL || "https://hub.fraggell.com";

// List the client slugs that have a populated brand kit, so the panel knows
// which client rows should show a brand-kit button.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.SOP_SERVICE_TOKEN;
  if (!token) {
    // Not configured — behave as "no kits available" rather than erroring, so
    // the panel simply shows no brand-kit buttons.
    return NextResponse.json({ kits: [] });
  }

  try {
    const res = await fetch(`${HUB_BASE}/api/brand-kits`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ kits: [] });
    const data = await res.json();
    return NextResponse.json({ kits: data.kits || [] });
  } catch {
    return NextResponse.json({ kits: [] });
  }
}
