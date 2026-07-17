CREATE TYPE "public"."request_event_category" AS ENUM('BUILT_IN', 'CUSTOM');--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'CUSTOM_EVENT' BEFORE 'REQUEST_CREATED';--> statement-breakpoint
ALTER TABLE "request_events" ADD COLUMN "category" "request_event_category" DEFAULT 'BUILT_IN' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_events" ADD COLUMN "custom_type" varchar(80);--> statement-breakpoint
ALTER TABLE "request_events" ADD COLUMN "visibility" "comment_visibility" DEFAULT 'INTERNAL' NOT NULL;