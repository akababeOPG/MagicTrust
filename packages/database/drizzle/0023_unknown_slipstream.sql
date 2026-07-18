CREATE TYPE "public"."form_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."form_version_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "form_version_status" DEFAULT 'DRAFT' NOT NULL,
	"html" text NOT NULL,
	"css" text NOT NULL,
	"javascript" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_admin_user_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_admin_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(32) NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"status" "form_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_admin_user_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_events" ALTER COLUMN "target_admin_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD COLUMN "form_id" uuid;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_published_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("published_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_form_version_idx" ON "form_versions" USING btree ("form_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_one_draft_idx" ON "form_versions" USING btree ("form_id") WHERE "form_versions"."status" = 'DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_one_published_idx" ON "form_versions" USING btree ("form_id") WHERE "form_versions"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "form_versions_form_created_at_idx" ON "form_versions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_public_id_idx" ON "forms" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_slug_idx" ON "forms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "forms_status_updated_at_idx" ON "forms" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_events_form_id_idx" ON "admin_audit_events" USING btree ("form_id");