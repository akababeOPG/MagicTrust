ALTER TYPE "public"."request_event_type" ADD VALUE 'REQUEST_ASSIGNED';--> statement-breakpoint
ALTER TYPE "public"."request_event_type" ADD VALUE 'REQUEST_UNASSIGNED';--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "assigned_to_admin_user_id" uuid;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "assigned_by_admin_user_id" uuid;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_assigned_to_admin_user_id_admin_users_id_fk" FOREIGN KEY ("assigned_to_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_assigned_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("assigned_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_assigned_to_created_at_id_idx" ON "privacy_requests" USING btree ("assigned_to_admin_user_id","created_at","id");