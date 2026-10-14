CREATE SCHEMA "service_finder";
--> statement-breakpoint
CREATE TYPE "service_finder"."bo_http_method" AS ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE');--> statement-breakpoint
CREATE TABLE "service_finder"."bo_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bo_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "service_finder"."bo_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bo_permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "service_finder"."bo_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_finder"."bo_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method" "service_finder"."bo_http_method" NOT NULL,
	"path" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_finder"."bo_endpoint_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_finder"."bo_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"google_sub" varchar(255),
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"mfa_verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bo_users_email_unique" UNIQUE("email"),
	CONSTRAINT "bo_users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "service_finder"."bo_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bo_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "service_finder"."bo_role_permissions" ADD CONSTRAINT "bo_role_permissions_role_id_bo_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "service_finder"."bo_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."bo_role_permissions" ADD CONSTRAINT "bo_role_permissions_permission_id_bo_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "service_finder"."bo_permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."bo_endpoint_permissions" ADD CONSTRAINT "bo_endpoint_permissions_endpoint_id_bo_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "service_finder"."bo_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."bo_endpoint_permissions" ADD CONSTRAINT "bo_endpoint_permissions_permission_id_bo_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "service_finder"."bo_permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."bo_users" ADD CONSTRAINT "bo_users_role_id_bo_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "service_finder"."bo_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."bo_refresh_tokens" ADD CONSTRAINT "bo_refresh_tokens_user_id_bo_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "service_finder"."bo_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bo_role_permissions_role_id_idx" ON "service_finder"."bo_role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bo_role_permissions_role_permission_uq" ON "service_finder"."bo_role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bo_endpoints_method_path_uq" ON "service_finder"."bo_endpoints" USING btree ("method","path");--> statement-breakpoint
CREATE INDEX "bo_endpoint_permissions_endpoint_id_idx" ON "service_finder"."bo_endpoint_permissions" USING btree ("endpoint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bo_endpoint_permissions_endpoint_permission_uq" ON "service_finder"."bo_endpoint_permissions" USING btree ("endpoint_id","permission_id");--> statement-breakpoint
CREATE INDEX "bo_users_role_id_idx" ON "service_finder"."bo_users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "bo_refresh_tokens_user_id_idx" ON "service_finder"."bo_refresh_tokens" USING btree ("user_id");