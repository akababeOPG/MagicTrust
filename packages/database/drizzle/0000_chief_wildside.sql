CREATE TYPE "public"."actor_type" AS ENUM('CONSUMER', 'INTERNAL_USER', 'API_CLIENT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."request_event_type" AS ENUM('REQUEST_CREATED');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('SUBMITTED', 'PENDING_VERIFICATION', 'VERIFIED', 'PROCESSING', 'WAITING_FOR_REQUESTER', 'SUCCESS', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('DATA_ACCESS', 'DATA_DELETION', 'DO_NOT_CONTACT', 'UNSUBSCRIBE', 'GENERAL_INQUIRY');--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(32) NOT NULL,
	"requester_id" uuid NOT NULL,
	"type" "request_type" NOT NULL,
	"status" "request_status" DEFAULT 'SUBMITTED' NOT NULL,
	"submitted_data" jsonb NOT NULL,
	"mutable_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privacy_request_id" uuid NOT NULL,
	"type" "request_event_type" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" varchar(128),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requesters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar(128),
	"email_encrypted" text,
	"phone_encrypted" text,
	"name_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_requester_id_requesters_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."requesters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_privacy_request_id_privacy_requests_id_fk" FOREIGN KEY ("privacy_request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_public_id_idx" ON "privacy_requests" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_requester_id_idx" ON "privacy_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_status_idx" ON "privacy_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "request_events_privacy_request_id_idx" ON "request_events" USING btree ("privacy_request_id");--> statement-breakpoint
CREATE INDEX "requesters_external_id_idx" ON "requesters" USING btree ("external_id");