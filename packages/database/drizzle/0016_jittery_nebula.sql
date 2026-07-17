CREATE INDEX "privacy_requests_created_at_id_idx" ON "privacy_requests" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "privacy_requests_status_created_at_idx" ON "privacy_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_type_created_at_idx" ON "privacy_requests" USING btree ("type","created_at");