CREATE TABLE "ai_provider_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"model" varchar(255) NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"api_key_nonce" varchar(64) NOT NULL,
	"api_key_auth_tag" varchar(64) NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD CONSTRAINT "ai_provider_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;