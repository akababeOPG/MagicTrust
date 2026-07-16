ALTER TYPE "public"."request_event_type" ADD VALUE 'CONSUMER_ACCESS_SESSION_CREATED';--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'CONSUMER_ACCESS_SESSION_USED';--> statement-breakpoint
CREATE TABLE "request_access_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"session_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "request_access_sessions" ADD CONSTRAINT "request_access_sessions_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_access_sessions_request_id_idx" ON "request_access_sessions" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_access_sessions_session_hash_idx" ON "request_access_sessions" USING btree ("session_hash");