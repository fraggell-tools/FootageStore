import { NextRequest, NextResponse } from "next/server";
import { consumeCode } from "@/lib/panel-code-store";

// PKCE exchange for the Premiere panel loopback flow. The panel POSTs the
// one-time `code` it received on the loopback redirect plus the `verifier` whose
// SHA-256 matches the challenge it sent to panel-login. Only then do we return
// the session token — so catching the loopback redirect alone is useless.
export async function POST(req: NextRequest) {
  let body: { code?: unknown; verifier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const verifier = typeof body.verifier === "string" ? body.verifier : "";
  if (!code || !verifier) {
    return NextResponse.json({ error: "code and verifier required" }, { status: 400 });
  }

  const token = consumeCode(code, verifier);
  if (!token) {
    return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
  }

  return NextResponse.json({ sessionToken: token }, { headers: { "Cache-Control": "no-store" } });
}
