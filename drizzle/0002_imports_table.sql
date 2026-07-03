-- imports table for the Drive import tool (admin bulk-copy from external shared folders).
-- Like 0000/0001 this runs against a push-originated database with no
-- __drizzle_migrations table, so every statement is idempotent.

DO $$ BEGIN
 CREATE TYPE "public"."import_status" AS ENUM('pending', 'running', 'completed', 'completed_with_errors', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"source_folder_id" varchar(255) NOT NULL,
	"source_folder_name" varchar(500) NOT NULL,
	"selection" jsonb NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"copied_files" integer DEFAULT 0 NOT NULL,
	"skipped_files" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imports" ADD CONSTRAINT "imports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
