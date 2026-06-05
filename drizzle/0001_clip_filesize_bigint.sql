-- Widen clips.file_size to bigint. The column was int4 (max ~2.14GB), so video
-- files larger than that failed to insert during Drive sync. bigint removes the cap.
--
-- This migration also records the `transcript` and `has_speech` columns, which were
-- previously added to the live database with `drizzle-kit push` but never captured in
-- a migration (the 0000 snapshot predates them). Like 0000, this runs against a
-- push-originated database, so every statement is idempotent and safe to re-run.

ALTER TABLE "clips" ALTER COLUMN "file_size" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "transcript" text;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "has_speech" boolean;
