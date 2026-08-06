CREATE TYPE "public"."contact_kind" AS ENUM('phone', 'email', 'whatsapp', 'address', 'instagram', 'linkedin', 'facebook', 'x', 'website', 'other');--> statement-breakpoint
CREATE TYPE "public"."living_status" AS ENUM('living', 'deceased', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."parent_role" AS ENUM('biological', 'adoptive', 'step', 'foster', 'guardian');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'rejected', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."relation_kind" AS ENUM('cousin', 'in_law', 'step_sibling', 'godparent', 'friend', 'close_friend', 'family_friend', 'neighbour', 'classmate', 'roommate', 'colleague', 'business_partner', 'mentor', 'teacher', 'employer', 'caregiver', 'other');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('female', 'male', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."tree_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."union_status" AS ENUM('partnered', 'married', 'separated', 'divorced', 'widowed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."verification" AS ENUM('unverified', 'family_recalled', 'self_confirmed', 'documented', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('tree', 'linked', 'shared');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "contact_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "contact_kind" NOT NULL,
	"value" text NOT NULL,
	"label" text,
	"visibility" "visibility" DEFAULT 'tree' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"given_name" text,
	"family_name" text,
	"birth_family_name" text,
	"nickname" text,
	"sex" "sex" DEFAULT 'unknown' NOT NULL,
	"birth_date" date,
	"birth_date_approx" text,
	"birth_place" text,
	"death_date" date,
	"death_date_approx" text,
	"death_place" text,
	"living" "living_status" DEFAULT 'unknown' NOT NULL,
	"bio" text,
	"photo_key" text,
	"current_place" text,
	"occupation" text,
	"verification" "verification" DEFAULT 'unverified' NOT NULL,
	"source_note" text,
	"verified_at" timestamp with time zone,
	"verified_by_id" uuid,
	"claimed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"proposed_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"kind" "relation_kind" NOT NULL,
	"label" text,
	"closeness" integer,
	"start_date" date,
	"end_date" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tree_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"email" text,
	"github_login" text,
	"role" "tree_role" DEFAULT 'viewer' NOT NULL,
	"as_person_id" uuid,
	"token" text NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"invited_by_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tree_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tree_members" (
	"tree_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "tree_role" DEFAULT 'viewer' NOT NULL,
	"invited_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tree_members_tree_id_user_id_pk" PRIMARY KEY("tree_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "trees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"root_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "union_children" (
	"union_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"role" "parent_role" DEFAULT 'biological' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "union_children_union_id_child_id_pk" PRIMARY KEY("union_id","child_id")
);
--> statement-breakpoint
CREATE TABLE "unions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"partner_a_id" uuid,
	"partner_b_id" uuid,
	"status" "union_status" DEFAULT 'unknown' NOT NULL,
	"start_date" date,
	"end_date" date,
	"place" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"github_login" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_details" ADD CONSTRAINT "contact_details_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_person_a_id_people_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_person_b_id_people_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_proposed_by_id_users_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relations" ADD CONSTRAINT "person_relations_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relations" ADD CONSTRAINT "person_relations_person_a_id_people_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relations" ADD CONSTRAINT "person_relations_person_b_id_people_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_invites" ADD CONSTRAINT "tree_invites_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_invites" ADD CONSTRAINT "tree_invites_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trees" ADD CONSTRAINT "trees_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "union_children" ADD CONSTRAINT "union_children_union_id_unions_id_fk" FOREIGN KEY ("union_id") REFERENCES "public"."unions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "union_children" ADD CONSTRAINT "union_children_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_partner_a_id_people_id_fk" FOREIGN KEY ("partner_a_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_partner_b_id_people_id_fk" FOREIGN KEY ("partner_b_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_details_person_idx" ON "contact_details" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_details_unique_idx" ON "contact_details" USING btree ("person_id","kind","value");--> statement-breakpoint
CREATE INDEX "people_tree_idx" ON "people" USING btree ("tree_id");--> statement-breakpoint
CREATE INDEX "people_name_idx" ON "people" USING btree ("family_name","given_name");--> statement-breakpoint
CREATE UNIQUE INDEX "person_links_pair_idx" ON "person_links" USING btree ("person_a_id","person_b_id");--> statement-breakpoint
CREATE INDEX "person_links_b_idx" ON "person_links" USING btree ("person_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_relations_unique_idx" ON "person_relations" USING btree ("person_a_id","person_b_id","kind");--> statement-breakpoint
CREATE INDEX "person_relations_tree_idx" ON "person_relations" USING btree ("tree_id");--> statement-breakpoint
CREATE INDEX "person_relations_b_idx" ON "person_relations" USING btree ("person_b_id");--> statement-breakpoint
CREATE INDEX "tree_invites_lookup_idx" ON "tree_invites" USING btree ("email","github_login","status");--> statement-breakpoint
CREATE UNIQUE INDEX "trees_owner_slug_idx" ON "trees" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "union_children_child_idx" ON "union_children" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "unions_tree_idx" ON "unions" USING btree ("tree_id");--> statement-breakpoint
CREATE INDEX "unions_partners_idx" ON "unions" USING btree ("partner_a_id","partner_b_id");