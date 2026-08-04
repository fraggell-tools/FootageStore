// One-time authorization-code store for the Premiere panel PKCE loopback flow.
//
// The bridge (panel-login) mints a short code bound to the session token and the
// panel's PKCE challenge; the panel exchanges it (panel-exchange) by presenting
// the matching verifier. This means a process that merely catches the loopback
// redirect can't use the code — it never saw the verifier. Codes are one-time and
// expire fast. In-memory is fine: FootageStore runs as a single long-lived Next
// server, and the code lives only for the seconds between redirect and exchange.

import { createHash } from "crypto";

type Entry = { token: string; challenge: string; expiresAt: number };

const store = new Map<string, Entry>();
const TTL_MS = 120_000; // 2 minutes

function sweep() {
  const now = Date.now();
  for (const [code, e] of store) {
    if (e.expiresAt <= now) store.delete(code);
  }
}

/** Store a session token against a code + PKCE challenge. Returns the TTL used. */
export function putCode(code: string, token: string, challenge: string): void {
  sweep();
  store.set(code, { token, challenge, expiresAt: Date.now() + TTL_MS });
}

/**
 * Consume a code (one-time). Returns the token only if the code exists, is
 * unexpired, and the SHA-256 of `verifier` matches the stored challenge.
 */
export function consumeCode(code: string, verifier: string): string | null {
  sweep();
  const e = store.get(code);
  if (!e) return null;
  store.delete(code); // one-time regardless of outcome
  if (e.expiresAt <= Date.now()) return null;
  // Verify PKCE: challenge = base64url(sha256(verifier))
  const computed = createHash("sha256").update(verifier).digest("base64url");
  if (computed !== e.challenge) return null;
  return e.token;
}
