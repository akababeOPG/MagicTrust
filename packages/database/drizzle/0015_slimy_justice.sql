ALTER TABLE "request_communications" ALTER COLUMN "recipient" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "submitted_data_encrypted" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "submitted_data_hash" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "encryption_version" integer;--> statement-breakpoint
ALTER TABLE "request_communications" ADD COLUMN "recipient_encrypted" text;--> statement-breakpoint
ALTER TABLE "request_communications" ADD COLUMN "recipient_hash" text;--> statement-breakpoint
ALTER TABLE "request_communications" ADD COLUMN "encryption_version" integer;