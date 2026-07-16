ALTER TABLE "requesters" ADD COLUMN "email_hash" text;--> statement-breakpoint
ALTER TABLE "requesters" ADD COLUMN "phone_hash" text;--> statement-breakpoint
CREATE INDEX "requesters_email_hash_idx" ON "requesters" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "requesters_phone_hash_idx" ON "requesters" USING btree ("phone_hash");