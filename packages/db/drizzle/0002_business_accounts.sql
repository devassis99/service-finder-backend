CREATE TABLE "service_finder"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "service_finder"."staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_finder"."staff_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "staff_permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "service_finder"."staff_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_finder"."staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"google_sub" varchar(255),
	"role_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"mfa_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "staff_users_email_unique" UNIQUE("email"),
	CONSTRAINT "staff_users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "service_finder"."staff_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "staff_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "service_finder"."staff_password_reset_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"code_hash" varchar(255) NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_finder"."account_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "account_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "service_finder"."staff_roles" ADD CONSTRAINT "staff_roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "service_finder"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."staff_role_permissions" ADD CONSTRAINT "staff_role_permissions_role_id_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "service_finder"."staff_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."staff_role_permissions" ADD CONSTRAINT "staff_role_permissions_permission_id_staff_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "service_finder"."staff_permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."staff_users" ADD CONSTRAINT "staff_users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "service_finder"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."staff_users" ADD CONSTRAINT "staff_users_role_id_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "service_finder"."staff_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."staff_invites" ADD CONSTRAINT "staff_invites_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "service_finder"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."staff_invites" ADD CONSTRAINT "staff_invites_invited_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("invited_by_staff_user_id") REFERENCES "service_finder"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."staff_password_reset_codes" ADD CONSTRAINT "staff_password_reset_codes_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "service_finder"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."account_refresh_tokens" ADD CONSTRAINT "account_refresh_tokens_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "service_finder"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_roles_account_id_idx" ON "service_finder"."staff_roles" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_roles_account_name_uq" ON "service_finder"."staff_roles" USING btree ("account_id","name");--> statement-breakpoint
CREATE INDEX "staff_role_permissions_role_id_idx" ON "service_finder"."staff_role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_role_permissions_role_permission_uq" ON "service_finder"."staff_role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX "staff_users_account_id_idx" ON "service_finder"."staff_users" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "staff_users_role_id_idx" ON "service_finder"."staff_users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "staff_invites_staff_user_id_idx" ON "service_finder"."staff_invites" USING btree ("staff_user_id");--> statement-breakpoint
CREATE INDEX "staff_password_reset_codes_staff_user_id_idx" ON "service_finder"."staff_password_reset_codes" USING btree ("staff_user_id");--> statement-breakpoint
CREATE INDEX "account_refresh_tokens_staff_user_id_idx" ON "service_finder"."account_refresh_tokens" USING btree ("staff_user_id");