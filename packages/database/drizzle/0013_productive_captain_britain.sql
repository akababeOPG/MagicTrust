CREATE TABLE "api_idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"api_client_id" varchar(128) NOT NULL,
	"method" varchar(16) NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_records_client_key_idx" ON "api_idempotency_records" USING btree ("api_client_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "api_idempotency_records_expires_at_idx" ON "api_idempotency_records" USING btree ("expires_at");