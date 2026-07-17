CREATE TABLE "api_client_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_client_id" uuid NOT NULL,
	"key_prefix" varchar(32) NOT NULL,
	"key_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_client_scopes" (
	"api_client_id" uuid NOT NULL,
	"scope" varchar(64) NOT NULL,
	CONSTRAINT "api_client_scopes_api_client_id_scope_pk" PRIMARY KEY("api_client_id","scope")
);
--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_client_keys" ADD CONSTRAINT "api_client_keys_api_client_id_api_clients_id_fk" FOREIGN KEY ("api_client_id") REFERENCES "public"."api_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_client_scopes" ADD CONSTRAINT "api_client_scopes_api_client_id_api_clients_id_fk" FOREIGN KEY ("api_client_id") REFERENCES "public"."api_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_client_keys_key_prefix_idx" ON "api_client_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "api_client_keys_api_client_id_idx" ON "api_client_keys" USING btree ("api_client_id");--> statement-breakpoint
CREATE INDEX "api_clients_active_idx" ON "api_clients" USING btree ("active");