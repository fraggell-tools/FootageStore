/**
 * Shared-secret auth for server-to-server callers that have no browser session.
 *
 * The review app (fraggell-review) embeds footage clips in review comments and
 * has to resolve codes, stream proxies and fetch thumbnails from its own server.
 * It authorises the end user itself before calling us, so what it needs here is
 * machine access, not a user session. This is the mirror of REVIEW_SERVICE_TOKEN,
 * which we already present when reading concept briefs back from the review app.
 *
 * Read-only routes only. Anything that mutates a clip still requires a real
 * session and an admin role.
 */
export function isServiceRequest(request: Request): boolean {
  const token = process.env.FOOTAGE_STORE_SERVICE_TOKEN;
  if (!token) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  // Constant-time-ish compare: bail on length first so a mismatched length
  // doesn't leak via early exit on the first differing character.
  const presented = header.replace(/^Bearer\s+/i, "");
  if (presented.length !== token.length) return false;

  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= presented.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
