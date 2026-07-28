/**
 * Kinfolk schema (Neon Postgres via Drizzle).
 *
 * The central modelling decision: a family tree is NOT a tree. It is a directed
 * acyclic graph with two distinct edge kinds, and the same human being can be
 * described by several different users who have never met each other.
 *
 * So we separate three things that naive schemas conflate:
 *
 *   1. `people`   -- a CLAIM about a human, owned by exactly one tree.
 *   2. `unions`   -- a partnership; parentage hangs off the union, not off a
 *                    parent pair, so remarriages and half-siblings fall out for
 *                    free instead of needing special cases.
 *   3. `personLinks` -- an assertion that person A in my tree and person B in
 *                    your tree are the SAME human. Merging is a link, never a
 *                    destructive rewrite: nobody's rows get overwritten when
 *                    two families connect.
 *
 * That third table is what makes "see how the combined family tree looks"
 * possible without either side losing ownership of their own data.
 */
import { relations } from "drizzle-orm";
import {
	date,
	index,
	integer,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately open-ended. "unknown" is a first-class value because genealogy
 * is mostly incomplete data, and forcing a guess corrupts the record.
 */
export const sexEnum = pgEnum("sex", ["female", "male", "other", "unknown"]);

/** How a union ended, if it did. Drives dashed vs solid edges in the canvas. */
export const unionStatusEnum = pgEnum("union_status", [
	"partnered",
	"married",
	"separated",
	"divorced",
	"widowed",
	"unknown",
]);

/** Biological vs social parentage. Both are real; the UI labels them, not ranks them. */
export const parentRoleEnum = pgEnum("parent_role", [
	"biological",
	"adoptive",
	"step",
	"foster",
	"guardian",
]);

/** Who may do what inside a tree that is not theirs. */
export const treeRoleEnum = pgEnum("tree_role", ["owner", "editor", "viewer"]);

/** Lifecycle of a share invite or a cross-tree merge proposal. */
export const proposalStatusEnum = pgEnum("proposal_status", [
	"pending",
	"accepted",
	"rejected",
	"revoked",
]);

/* -------------------------------------------------------------------------- */
/* Auth (Auth.js v5 / Drizzle adapter shape)                                  */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name"),
	email: text("email").notNull().unique(),
	emailVerified: timestamp("email_verified", { withTimezone: true }),
	image: text("image"),
	/** GitHub handle, cached for the invite-by-username flow. */
	githubLogin: text("github_login"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
	"accounts",
	{
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		provider: text("provider").notNull(),
		providerAccountId: text("provider_account_id").notNull(),
		// The Auth.js Drizzle adapter matches these by TS property name, so they
		// stay snake_case here even though the rest of the schema is camelCase.
		// `expires_at` is OAuth epoch SECONDS (integer), not a timestamp.
		refresh_token: text("refresh_token"),
		access_token: text("access_token"),
		expires_at: integer("expires_at"),
		token_type: text("token_type"),
		scope: text("scope"),
		id_token: text("id_token"),
		session_state: text("session_state"),
	},
	(t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
	sessionToken: text("session_token").primaryKey(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	expires: timestamp("expires", { withTimezone: true }).notNull(),
});

/* -------------------------------------------------------------------------- */
/* Trees and access                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A tree is a workspace, not a family. One user may keep several (their own
 * lineage, a spouse's lineage, a research project on a surname).
 */
export const trees = pgTable(
	"trees",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description"),
		ownerId: uuid("owner_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/** The person the owner identifies as; the canvas opens centred here. */
		rootPersonId: uuid("root_person_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [uniqueIndex("trees_owner_slug_idx").on(t.ownerId, t.slug)],
);

/** Explicit grants. Absence of a row means no access: private by default. */
export const treeMembers = pgTable(
	"tree_members",
	{
		treeId: uuid("tree_id")
			.notNull()
			.references(() => trees.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: treeRoleEnum("role").notNull().default("viewer"),
		invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [primaryKey({ columns: [t.treeId, t.userId] })],
);

/**
 * Invites are addressed by email or GitHub login because the invitee usually
 * has no account yet. Claimed on first sign-in by matching either identifier.
 */
export const treeInvites = pgTable(
	"tree_invites",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		treeId: uuid("tree_id")
			.notNull()
			.references(() => trees.id, { onDelete: "cascade" }),
		email: text("email"),
		githubLogin: text("github_login"),
		role: treeRoleEnum("role").notNull().default("viewer"),
		/** Optional: "you are this person in my tree", pre-linking on accept. */
		asPersonId: uuid("as_person_id"),
		token: text("token").notNull().unique(),
		status: proposalStatusEnum("status").notNull().default("pending"),
		invitedById: uuid("invited_by_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [index("tree_invites_lookup_idx").on(t.email, t.githubLogin, t.status)],
);

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A person row is one tree's claim about a human. Two trees describing the same
 * grandfather hold two rows; `personLinks` ties them together.
 *
 * Dates are `date`, not `timestamp`: birthdays have no timezone, and storing
 * them as instants shifts people across midnight depending on the reader.
 * `*Approx` carries the fuzzy cases genealogy is full of ("about 1890").
 */
export const people = pgTable(
	"people",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		treeId: uuid("tree_id")
			.notNull()
			.references(() => trees.id, { onDelete: "cascade" }),
		givenName: text("given_name"),
		familyName: text("family_name"),
		/** Maiden or pre-marriage name; kept separate so search finds both. */
		birthFamilyName: text("birth_family_name"),
		nickname: text("nickname"),
		sex: sexEnum("sex").notNull().default("unknown"),
		birthDate: date("birth_date"),
		birthDateApprox: text("birth_date_approx"),
		birthPlace: text("birth_place"),
		deathDate: date("death_date"),
		deathDateApprox: text("death_date_approx"),
		deathPlace: text("death_place"),
		/** Null means unknown, which is NOT the same as alive. Prefer the date fields. */
		bio: text("bio"),
		photoKey: text("photo_key"),
		/** Set when this person row corresponds to a real signed-in user. */
		claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [
		index("people_tree_idx").on(t.treeId),
		index("people_name_idx").on(t.familyName, t.givenName),
	],
);

/* -------------------------------------------------------------------------- */
/* Relationships                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A union is a partnership node. Parentage attaches to the union rather than to
 * a (father, mother) column pair, which is what lets a person have two sets of
 * parents, half-siblings, single parents, and remarriages without branching
 * logic anywhere in the renderer.
 *
 * Both partner columns are nullable so a single parent still forms a union.
 */
export const unions = pgTable(
	"unions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		treeId: uuid("tree_id")
			.notNull()
			.references(() => trees.id, { onDelete: "cascade" }),
		partnerAId: uuid("partner_a_id").references(() => people.id, { onDelete: "cascade" }),
		partnerBId: uuid("partner_b_id").references(() => people.id, { onDelete: "cascade" }),
		status: unionStatusEnum("status").notNull().default("unknown"),
		startDate: date("start_date"),
		endDate: date("end_date"),
		place: text("place"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [
		index("unions_tree_idx").on(t.treeId),
		index("unions_partners_idx").on(t.partnerAId, t.partnerBId),
	],
);

/**
 * Child membership in a union. The composite PK prevents the same child being
 * attached to one union twice; a child CAN belong to two unions (birth family
 * plus adoptive family), which is intentional and why this is not a column on
 * `people`.
 */
export const unionChildren = pgTable(
	"union_children",
	{
		unionId: uuid("union_id")
			.notNull()
			.references(() => unions.id, { onDelete: "cascade" }),
		childId: uuid("child_id")
			.notNull()
			.references(() => people.id, { onDelete: "cascade" }),
		role: parentRoleEnum("role").notNull().default("biological"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.unionId, t.childId] }),
		index("union_children_child_idx").on(t.childId),
	],
);

/* -------------------------------------------------------------------------- */
/* Cross-tree stitching                                                       */
/* -------------------------------------------------------------------------- */

/**
 * "These two person rows are the same human."
 *
 * Non-destructive by design: linking never deletes or rewrites either side, so
 * two families can connect their trees and later disagree or unlink without
 * data loss. The combined view walks these links to fuse the graphs at read
 * time.
 *
 * Requires consent from both trees, hence `status` -- a one-sided assertion
 * stays `pending` and does not affect anyone else's view.
 */
export const personLinks = pgTable(
	"person_links",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		personAId: uuid("person_a_id")
			.notNull()
			.references(() => people.id, { onDelete: "cascade" }),
		personBId: uuid("person_b_id")
			.notNull()
			.references(() => people.id, { onDelete: "cascade" }),
		status: proposalStatusEnum("status").notNull().default("pending"),
		note: text("note"),
		proposedById: uuid("proposed_by_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [
		// One proposal per ordered pair. Application code must sort the two ids
		// before insert so (A,B) and (B,A) cannot both exist.
		uniqueIndex("person_links_pair_idx").on(t.personAId, t.personBId),
		index("person_links_b_idx").on(t.personBId),
	],
);

/* -------------------------------------------------------------------------- */
/* Relations (for Drizzle's relational queries)                               */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
	trees: many(trees),
	memberships: many(treeMembers),
}));

export const treesRelations = relations(trees, ({ one, many }) => ({
	owner: one(users, { fields: [trees.ownerId], references: [users.id] }),
	people: many(people),
	unions: many(unions),
	members: many(treeMembers),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
	tree: one(trees, { fields: [people.treeId], references: [trees.id] }),
	childOf: many(unionChildren),
}));

export const unionsRelations = relations(unions, ({ one, many }) => ({
	tree: one(trees, { fields: [unions.treeId], references: [trees.id] }),
	partnerA: one(people, { fields: [unions.partnerAId], references: [people.id] }),
	partnerB: one(people, { fields: [unions.partnerBId], references: [people.id] }),
	children: many(unionChildren),
}));

export const unionChildrenRelations = relations(unionChildren, ({ one }) => ({
	union: one(unions, { fields: [unionChildren.unionId], references: [unions.id] }),
	child: one(people, { fields: [unionChildren.childId], references: [people.id] }),
}));

export type User = typeof users.$inferSelect;
export type Tree = typeof trees.$inferSelect;
export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type Union = typeof unions.$inferSelect;
export type PersonLink = typeof personLinks.$inferSelect;
