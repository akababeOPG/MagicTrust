CREATE TABLE "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(64) NOT NULL,
	"target_admin_user_id" uuid NOT NULL,
	"actor_admin_user_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_target_admin_user_id_admin_users_id_fk" FOREIGN KEY ("target_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actor_admin_user_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_events_target_admin_user_id_idx" ON "admin_audit_events" USING btree ("target_admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_events_actor_admin_user_id_idx" ON "admin_audit_events" USING btree ("actor_admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_events_created_at_idx" ON "admin_audit_events" USING btree ("created_at");