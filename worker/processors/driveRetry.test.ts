import { describe, it, expect, vi } from "vitest";
import { withDriveRetry, isRetryableDriveError } from "./driveRetry";

const rateLimit403 = { code: 403, errors: [{ reason: "userRateLimitExceeded" }] };
const tooMany429 = { code: 429 };
const forbidden = { code: 403, errors: [{ reason: "cannotCopyFile" }] };

describe("isRetryableDriveError", () => {
  it("retries 429", () => expect(isRetryableDriveError(tooMany429)).toBe(true));
  it("retries 403 rate limits", () => expect(isRetryableDriveError(rateLimit403)).toBe(true));
  it("does not retry cannotCopyFile", () => expect(isRetryableDriveError(forbidden)).toBe(false));
  it("does not retry unknown errors", () => expect(isRetryableDriveError(new Error("boom"))).toBe(false));
});

describe("withDriveRetry", () => {
  it("returns the result on first success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const result = await withDriveRetry(async () => 42, { sleep });
    expect(result).toBe(42);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries retryable errors with growing backoff, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const result = await withDriveRetry(
      async () => {
        calls++;
        if (calls < 3) throw tooMany429;
        return "ok";
      },
      { baseDelayMs: 100, sleep }
    );
    expect(result).toBe("ok");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[1][0]).toBeGreaterThan(sleep.mock.calls[0][0]);
  });

  it("throws immediately on non-retryable errors", async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      withDriveRetry(async () => { throw forbidden; }, { sleep })
    ).rejects.toBe(forbidden);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the retry budget", async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      withDriveRetry(async () => { throw tooMany429; }, { retries: 2, sleep })
    ).rejects.toBe(tooMany429);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
