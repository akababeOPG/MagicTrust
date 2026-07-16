ALTER TYPE "public"."request_event_type" ADD VALUE 'PUBLIC_ATTACHMENT_ADDED';--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'INTERNAL_ATTACHMENT_ADDED';--> statement-breakpoint
CREATE TABLE "request_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"visibility" "comment_visibility" NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_provider" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_attachments_request_id_idx" ON "request_attachments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_attachments_visibility_idx" ON "request_attachments" USING btree ("visibility");