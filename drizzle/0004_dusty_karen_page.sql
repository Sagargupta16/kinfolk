CREATE TABLE "people_creation_budgets" (
	"tree_id" uuid PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people_creation_budgets" ADD CONSTRAINT "people_creation_budgets_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;