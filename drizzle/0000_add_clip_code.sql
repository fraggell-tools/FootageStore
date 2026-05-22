-- Adds a short, unique, shareable code to every clip.
--
-- This is the first drizzle migration on a database whose tables were
-- originally created with `drizzle-kit push`, so it intentionally contains
-- only the delta (a single column) rather than a full baseline. Every
-- statement is idempotent, so the migration is safe to re-run.

ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "code" varchar(12);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clips_code_unique" ON "clips" USING btree ("code");
--> statement-breakpoint
-- Backfill existing clips with unique 6-character codes.
-- Alphabet excludes ambiguous characters (0/O, 1/I/L) and U.
DO $$
DECLARE
	alphabet text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
	candidate text;
	rec record;
BEGIN
	FOR rec IN SELECT id FROM clips WHERE code IS NULL LOOP
		LOOP
			candidate := '';
			FOR pos IN 1..6 LOOP
				candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
			END LOOP;
			EXIT WHEN NOT EXISTS (SELECT 1 FROM clips WHERE code = candidate);
		END LOOP;
		UPDATE clips SET code = candidate WHERE id = rec.id;
	END LOOP;
END $$;
