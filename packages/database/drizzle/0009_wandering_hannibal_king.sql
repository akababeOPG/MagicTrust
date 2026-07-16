ALTER TYPE "public"."request_event_type" ADD VALUE 'IDENTITY_VERIFICATION_SENT';--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'IDENTITY_VERIFIED';--> statement-breakpoint
CREATE TABLE "request_identity_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_identity_verification_tokens" ADD CONSTRAINT "request_identity_verification_tokens_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_identity_verification_tokens_request_id_idx" ON "request_identity_verification_tokens" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_identity_verification_tokens_token_hash_idx" ON "request_identity_verification_tokens" USING btree ("token_hash");