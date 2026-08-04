-- Dropbox import: imports get a source discriminator, and source_folder_id
-- becomes text because Dropbox shared links (with rlkey) can exceed 255 chars.
-- Like 0000-0004 this runs against a push-originated database with no
-- __drizzle_migrations table, so every statement is idempotent.

ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'drive' NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ALTER COLUMN "source_folder_id" SET DATA TYPE text;
