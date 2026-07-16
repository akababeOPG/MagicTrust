CREATE TYPE "public"."comment_visibility" AS ENUM('PUBLIC', 'INTERNAL');--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'STATUS_CHANGED';--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'PUBLIC_COMMENT_ADDED';--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'INTERNAL_COMMENT_ADDED';--> statement-breakpoint
CREATE TABLE "request_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"visibility" "comment_visibility" NOT NULL,
	"body" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_comments_request_id_idx" ON "request_comments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_comments_visibility_idx" ON "request_comments" USING btree ("visibility");