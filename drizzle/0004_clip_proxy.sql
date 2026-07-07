-- Track the 480p preview proxy per clip: generation status, the R2 object key,
-- and the last error. Proxies live on Cloudflare R2 (zero egress) and are served
-- to the panel/web preview player; the original stays on Drive for import.
--
-- Idempotent (prod has no __drizzle_migrations table, built via drizzle-kit push).

ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "proxy_status" varchar(20) DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "proxy_r2_key" text;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "proxy_error" text;
