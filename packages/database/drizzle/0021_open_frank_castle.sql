ALTER TYPE "public"."request_event_type" ADD VALUE 'REQUEST_DUE_DATE_SET';--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'REQUEST_DUE_DATE_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'REQUEST_DUE_DATE_CLEARED';--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "due_at_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "due_at_set_by_admin_user_id" uuid;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_due_at_set_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("due_at_set_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_due_at_idx" ON "privacy_requests" USING btree ("due_at");