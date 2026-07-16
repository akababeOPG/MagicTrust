CREATE TYPE "public"."communication_channel" AS ENUM('EMAIL');--> statement-breakpoint
CREATE TYPE "public"."communication_direction" AS ENUM('OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."communication_status" AS ENUM('PENDING', 'SENT', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'EMAIL_SENT';--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'EMAIL_FAILED';--> statement-breakpoint
CREATE TABLE "request_communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"channel" "communication_channel" NOT NULL,
	"direction" "communication_direction" NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"provider" varchar(64) NOT NULL,
	"provider_message_id" text,
	"status" "communication_status" DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "request_communications" ADD CONSTRAINT "request_communications_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_communications_request_id_idx" ON "request_communications" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_communications_status_idx" ON "request_communications" USING btree ("status");