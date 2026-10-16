CREATE TYPE "service_finder"."billing_interval" AS ENUM('month', 'quarter', 'half_year', 'year');--> statement-breakpoint
CREATE TYPE "service_finder"."payment_link_discount_type" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TABLE "service_finder"."billing_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"stripe_product_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "billing_products_key_unique" UNIQUE("key"),
	CONSTRAINT "billing_products_stripe_product_id_unique" UNIQUE("stripe_product_id")
);
--> statement-breakpoint
CREATE TABLE "service_finder"."billing_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"stripe_price_id" varchar(255) NOT NULL,
	"billing_interval" "service_finder"."billing_interval" NOT NULL,
	"unit_amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"trial_days_override" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"show_on_signup" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "billing_prices_stripe_price_id_unique" UNIQUE("stripe_price_id")
);
--> statement-breakpoint
CREATE TABLE "service_finder"."billing_payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"price_id" uuid NOT NULL,
	"stripe_payment_link_id" varchar(255),
	"token" varchar(64),
	"url" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"seat_override" integer,
	"trial_days_override" integer,
	"discount_type" "service_finder"."payment_link_discount_type",
	"discount_value" integer,
	"stripe_coupon_id" varchar(255),
	"stripe_promotion_code" varchar(255),
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "billing_payment_links_stripe_payment_link_id_unique" UNIQUE("stripe_payment_link_id"),
	CONSTRAINT "billing_payment_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "service_finder"."billing_prices" ADD CONSTRAINT "billing_prices_product_id_billing_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "service_finder"."billing_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."billing_payment_links" ADD CONSTRAINT "billing_payment_links_product_id_billing_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "service_finder"."billing_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_finder"."billing_payment_links" ADD CONSTRAINT "billing_payment_links_price_id_billing_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "service_finder"."billing_prices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_prices_product_id_idx" ON "service_finder"."billing_prices" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_prices_product_interval_active_uq" ON "service_finder"."billing_prices" USING btree ("product_id","billing_interval") WHERE "service_finder"."billing_prices"."is_active" = true;