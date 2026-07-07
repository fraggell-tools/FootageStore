import { describe, it, expect } from "vitest";
import { rootErrorMessage } from "./dbError";

describe("rootErrorMessage", () => {
  it("returns the message of a plain error", () => {
    expect(rootErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the deepest cause's message (drizzle wraps pg errors)", () => {
    const pg = new Error('duplicate key value violates unique constraint "clients_slug_key"');
    const wrapped = new Error('Failed query: insert into "clients" ...', { cause: pg });
    expect(rootErrorMessage(wrapped)).toBe(
      'duplicate key value violates unique constraint "clients_slug_key"'
    );
  });

  it("walks multiple cause levels", () => {
    const inner = new Error("root cause");
    const mid = new Error("mid", { cause: inner });
    const outer = new Error("outer", { cause: mid });
    expect(rootErrorMessage(outer)).toBe("root cause");
  });

  it("handles non-Error values", () => {
    expect(rootErrorMessage("string error")).toBe("string error");
    expect(rootErrorMessage(undefined)).toBe("Unknown error");
  });
});
