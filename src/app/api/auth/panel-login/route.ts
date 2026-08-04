import { NextRequest, NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import { randomBytes } from "crypto";
import {
  verifyHubJwt,
  mintSessionForHubPayload,
  sessionCookieName,
} from "@/lib/hub-sso";
import { putCode } from "@/lib/panel-code-store";

// ── Premiere panel loopback SSO bridge (RFC 8252 native-app flow) ─────────────
//
// The CEP panel can't do a browser redirect flow itself, so it opens THIS url in
// the system browser. Here the user is already (or becomes) authenticated against
// the real Hub — so Logto, passkeys and MFA all apply. We then hand the panel's
// session token back to a one-shot 127.0.0.1 listener the panel is running
// (loopback mode), or display it as a copyable code (fallback mode).
//
// Security posture:
//  - `state` is a panel-generated nonce echoed back so the panel only accepts a
//    callback it initiated. Format-validated here.
//  - Loopback redirects go ONLY to 127.0.0.1/localhost with a numeric port — never
//    to a caller-supplied host — so the token can't be exfiltrated off-machine.
//  - Identity comes from the user's own Hub cookie (or an existing FootageStore
//    session); we never accept a token from the query.

const PANEL_SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, matches the old plugin token
const HUB_LOGIN = "https://hub.fraggell.com/login";

function isValidState(s: string | null): s is string {
  return !!s && /^[A-Za-z0-9_-]{8,128}$/.test(s);
}
function isValidChallenge(s: string | null): s is string {
  return !!s && /^[A-Za-z0-9_-]{20,128}$/.test(s);
}
function isValidPort(p: string | null): p is string {
  if (!p || !/^\d{1,5}$/.test(p)) return false;
  const n = parseInt(p, 10);
  return n >= 1024 && n <= 65535;
}
function publicOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "footagestore.fraggell.com";
  return `${proto}://${host}`;
}
function htmlPage(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#0e0f12;color:#e8e8ea;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{max-width:440px;padding:32px;text-align:center}.mark{width:52px;height:52px;border-radius:12px;background:#e84c88;color:#fff;font-weight:800;font-size:24px;display:flex;align-items:center;justify-content:center;margin:0 auto 18px}
h1{font-size:19px;margin:0 0 8px}p{color:#a0a0a8;margin:6px 0}code{display:block;word-break:break-all;background:#1a1c22;border:1px solid #2a2d36;border-radius:8px;padding:12px;margin:16px 0;font:12px/1.4 ui-monospace,monospace;color:#e8e8ea}
button{font:600 13px/1 inherit;background:#e84c88;color:#fff;border:none;border-radius:8px;padding:10px 16px;cursor:pointer}</style></head>
<body><div class="card"><div class="mark">F</div>${body}</div></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const state = sp.get("state");
  const challenge = sp.get("challenge");
  const mode = sp.get("mode") === "code" ? "code" : "loopback";
  const port = sp.get("port");

  if (!isValidState(state) || !isValidChallenge(challenge)) {
    return htmlPage("Sign-in error", `<h1>Sign-in link invalid</h1><p>Please start again from the panel in Premiere.</p>`, 400);
  }
  if (mode === "loopback" && !isValidPort(port)) {
    return htmlPage("Sign-in error", `<h1>Sign-in link invalid</h1><p>Please start again from the panel in Premiere.</p>`, 400);
  }

  const isSecure = publicOrigin(req).startsWith("https://");

  // 1) Resolve identity: prefer the Hub cookie, fall back to an existing
  //    FootageStore web session, else send the user through Hub login.
  let token: string | null = null;

  const hubToken = req.cookies.get("hub_auth")?.value;
  if (hubToken) {
    try {
      const payload = verifyHubJwt(hubToken);
      const minted = await mintSessionForHubPayload(payload, isSecure, PANEL_SESSION_MAX_AGE);
      if (!minted) {
        return htmlPage("Access denied", `<h1>No Footage Store access</h1><p>Your Hub role doesn’t have access to Footage Store. Contact Nick or Fraser.</p>`, 403);
      }
      token = minted.token;
    } catch {
      // fall through to existing-session / Hub-login
    }
  }

  if (!token) {
    // Already signed into the FootageStore web app in this browser? Reuse it.
    const existing = req.cookies.get(sessionCookieName(isSecure))?.value;
    if (existing) {
      try {
        const decoded = await decode({
          token: existing,
          secret: process.env.NEXTAUTH_SECRET!,
          salt: sessionCookieName(isSecure),
        });
        if (decoded?.email) token = existing;
      } catch {
        /* invalid/expired — ignore */
      }
    }
  }

  if (!token) {
    // Cold start: send the user through the real Hub login, returning here.
    const self = new URL(`${publicOrigin(req)}/api/auth/panel-login`);
    self.searchParams.set("state", state);
    self.searchParams.set("challenge", challenge);
    self.searchParams.set("mode", mode);
    if (mode === "loopback" && port) self.searchParams.set("port", port);
    const login = `${HUB_LOGIN}?redirect=${encodeURIComponent(self.toString())}`;
    return NextResponse.redirect(login);
  }

  // 2) PKCE: mint a one-time code bound to the token + the panel's challenge.
  //    The panel exchanges it for the token (presenting the verifier) so a
  //    process that merely catches the loopback redirect can't use the code.
  const code = randomBytes(9).toString("base64url"); // ~12 chars
  putCode(code, token, challenge);

  if (mode === "code") {
    return htmlPage(
      "Signed in",
      `<h1>Copy this code into Premiere</h1><p>Paste it into the panel’s sign-in box, then you can close this tab.</p>
       <code id="c">${code}</code>
       <button onclick="navigator.clipboard.writeText(document.getElementById('c').textContent).then(()=>this.textContent='Copied!')">Copy code</button>`
    );
  }

  // Loopback: redirect to the panel's local listener with the CODE (not the
  // token). Host is hard-coded to loopback; only the validated port is taken
  // from the request.
  const loopback = new URL(`http://127.0.0.1:${port}/`);
  loopback.searchParams.set("code", code);
  loopback.searchParams.set("state", state);
  return NextResponse.redirect(loopback.toString());
}
