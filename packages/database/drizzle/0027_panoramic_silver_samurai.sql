CREATE TYPE "public"."form_request_type_mode" AS ENUM('FIXED', 'USER_SELECTED');--> statement-breakpoint
ALTER TABLE "forms" RENAME COLUMN "request_type" TO "fixed_request_type";--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "request_type_mode" "form_request_type_mode" DEFAULT 'FIXED' NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "allowed_request_types" "request_type"[] DEFAULT ARRAY[]::request_type[] NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "fixed_request_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "fixed_request_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_request_type_configuration_check" CHECK (("forms"."request_type_mode" = 'FIXED' AND "forms"."fixed_request_type" IS NOT NULL AND cardinality("forms"."allowed_request_types") = 0) OR ("forms"."request_type_mode" = 'USER_SELECTED' AND "forms"."fixed_request_type" IS NULL AND cardinality("forms"."allowed_request_types") >= 2));
