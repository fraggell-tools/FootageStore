interface GoogleApiErrorShape {
  code?: number;
  response?: { status?: number };
  errors?: { reason?: string }[];
}

/** 429s and 403 rate-limit responses are transient; everything else is not. */
export function isRetryableDriveError(err: unknown): boolean {
  const e = err as GoogleApiErrorShape;
  const status = e?.code ?? e?.response?.status;
  if (status === 429) return true;
  if (status === 403) {
    const reason = e?.errors?.[0]?.reason || "";
    return reason === "rateLimitExceeded" || reason === "userRateLimitExceeded";
  }
  return false;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a Drive call, retrying rate-limit errors with exponential backoff + jitter.
 */
export async function withDriveRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<T> {
  const { retries = 5, baseDelayMs = 2000, sleep = defaultSleep } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableDriveError(err) || attempt >= retries) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 1000;
      await sleep(delay);
      attempt++;
    }
  }
}
