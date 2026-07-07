-- Add month + angle labels to clips, auto-derived from the Google Drive
-- Client > Month > Angle folder structure at sync time and editable in the UI.
--
-- Like the earlier migrations this runs against a push-originated database
-- (prod has no __drizzle_migrations table), so both statements are idempotent
-- and safe to re-run.

ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "month" varchar(50);--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "angle" varchar(100);
