import { randomInt } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { clips } from "./db/schema";

/**
 * Alphabet for clip codes — uppercase, with characters that are easy to
 * confuse when read aloud or typed removed (0/O, 1/I/L) along with U.
 * 30 characters → 30^6 ≈ 729 million possible codes.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 6;

/** Generates a random clip code, e.g. "K7M2QX". Not checked for uniqueness. */
function generateClipCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Generates a clip code that no existing clip is using. Retries on the
 * (extremely unlikely) event of a collision; the unique index on
 * clips.code is the ultimate guarantee.
 */
export async function generateUniqueClipCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateClipCode();
    const existing = await db
      .select({ id: clips.id })
      .from(clips)
      .where(eq(clips.code, code))
      .limit(1);
    if (existing.length === 0) return code;
  }
  throw new Error("Failed to generate a unique clip code after 10 attempts");
}
