/**
 * Drizzle wraps database errors in DrizzleQueryError, whose .message is the
 * raw SQL ("Failed query: ..."). The real Postgres error ("duplicate key ...")
 * lives down the .cause chain. Walk to the deepest message so callers can
 * classify errors and show something human.
 */
export function rootErrorMessage(err: unknown): string {
  let current = err;
  let message = "Unknown error";
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "string") {
      message = current;
      break;
    }
    const e = current as { message?: unknown; cause?: unknown };
    if (typeof e.message === "string" && e.message) message = e.message;
    current = e.cause;
  }
  return message;
}
