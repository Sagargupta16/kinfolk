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
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
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

/**
 * Whether a person is alive, as a stored tri-state rather than an inference.
 *
 * A missing death date is NOT the same as being alive -- most rows in a
 * genealogy have neither date -- so deriving it marks every half-recorded
 * great-grandparent as living. The renderer needs the difference because
 * "alive" and "not known" deserve different marks on a card.
 */
export const livingStatusEnum = pgEnum("living_status", ["living", "deceased", "unknown"]);

/**
 * How well attested a person row is.
 *
 * This is the level ASSERTED by the tree that owns the row. Corroboration by
 * another family is deliberately NOT stored here: it is derivable from accepted
 * person links at read time, and a stored copy would go stale the moment a link
 * was withdrawn.
 *
 * Ordered weakest to strongest, except `disputed`, which sits outside the ladder
 * because it is a conflict signal rather than a lesser degree of confidence.
 */
export const verificationEnum = pgEnum("verification", [
	/** Somebody typed it in. The default, and the honest one. */
	"unverified",
	/** Recalled by a relative who knew the person. */
	"family_recalled",
	/** The person themselves confirmed it while signed in. */
	"self_confirmed",
	/** Backed by a record: certificate, register, gravestone, archive scan. */
	"documented",
	/** Two sources disagree and nobody has resolved it. */
	"disputed",
]);

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

/**
 * Non-parentage relations: everything that is not "partner of" or "child of".
 *
 * Directed kinds are stored ONE way only -- "mentee" is not a value, it is
 * `mentor` read from the other end. Storing both directions would let the same
 * fact exist twice with nothing to reconcile the pair. See lib/tree/relations.ts
 * for the label/inverse table.
 */
export const relationKindEnum = pgEnum("relation_kind", [
	// Kin the union model cannot express on its own, or where the connecting
	// ancestor is unknown.
	"cousin",
	"in_law",
	"step_sibling",
	"godparent",
	// Social
	"friend",
	"close_friend",
	"family_friend",
	"neighbour",
	"classmate",
	"roommate",
	// Professional
	"colleague",
	"business_partner",
	"mentor",
	"teacher",
	"employer",
	// Care
	"caregiver",
	"other",
]);

/** Channel for a stored contact detail. */
export const contactKindEnum = pgEnum("contact_kind", [
	"phone",
	"email",
	"whatsapp",
	"address",
	"instagram",
	"linkedin",
	"facebook",
	"x",
	"website",
	"other",
]);

/**
 * Who may see a contact detail. Contact info is the most sensitive data in the
 * app -- a phone number is not public just because a family tree is shared --
 * so it defaults to the narrowest setting and widens only on an explicit choice.
 */
export const visibilityEnum = pgEnum("visibility", [
	/** Only the owning tree's members. */
	"tree",
	/** Anyone whose tree is joined to this one by an accepted person link. */
	"linked",
	/** Every signed-in viewer with any access to the tree. */
	"shared",
]);

/* -------------------------------------------------------------------------- */
/* Auth (Auth.js v5 / Drizzle adapter shape)                                  */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name"),
	/**
	 * Nullable, because GitHub does not always give us one.
	 *
	 * Auth.js asks for the `user:email` scope and falls back to `GET /user/emails`
	 * when the profile has no public address, but that fallback is not guaranteed:
	 * it is skipped when the request fails, and it reads `emails[0]` when nothing is
	 * marked primary, so an account with no verified address yields `undefined`.
	 * With `NOT NULL` here the adapter's `createUser` insert is then rejected by
	 * Postgres, and the visitor is bounced to `/api/auth/error?error=Configuration`
	 * -- a message about server configuration for what is really a missing field on
	 * their GitHub account.
	 *
	 * Left UNIQUE: two accounts sharing an address would be two people claiming one
	 * identity, and Postgres treats NULLs as distinct, so several address-less users
	 * coexist without colliding.
	 */
	email: text("email").unique(),
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
	(t) => [
		primaryKey({ columns: [t.treeId, t.userId] }),
		check("tree_members_grant_role_check", sql`${t.role} <> 'owner'`),
	],
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
	(t) => [
		index("tree_invites_lookup_idx").on(t.email, t.githubLogin, t.status),
		check("tree_invites_grant_role_check", sql`${t.role} <> 'owner'`),
	],
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
		/**
		 * Stored, not derived from `deathDate`. A row with neither date is the normal
		 * case in genealogy, and inferring "alive" from a missing death date quietly
		 * claims every unrecorded ancestor is still with us.
		 */
		living: livingStatusEnum("living").notNull().default("unknown"),
		bio: text("bio"),
		photoKey: text("photo_key"),
		/** Where they live now, or last did. Unlike a contact detail, this is not private. */
		currentPlace: text("current_place"),
		/** "carpenter", "schoolteacher" -- the one line a relative tends to remember. */
		occupation: text("occupation"),

		/* -- Provenance -------------------------------------------------------- */

		/**
		 * How well attested this row is, as asserted by its owning tree. Sits next to
		 * `sourceNote` because a `documented` claim with an empty note is the first
		 * thing a reviewer should look at.
		 */
		verification: verificationEnum("verification").notNull().default("unverified"),
		/** Free text: "birth certificate", "grandmother, interviewed 2019". */
		sourceNote: text("source_note"),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		verifiedById: uuid("verified_by_id").references(() => users.id, { onDelete: "set null" }),
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

/**
 * Any relation that is not parentage or partnership: cousins, friends,
 * colleagues, mentors, neighbours.
 *
 * Deliberately a separate table from `unions` rather than another union status.
 * These edges are NOT hierarchical -- a friend belongs to no generation -- and
 * feeding them to a layered layout would drag that friend into a lower row and
 * wreck the tree. Storing them apart is what lets the renderer lay out on
 * family edges only and overlay the rest.
 *
 * Self-relations are prevented in application code; Postgres cannot express
 * `personAId <> personBId` in a Drizzle index, so it lives in the insert path.
 */
export const personRelations = pgTable(
	"person_relations",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		treeId: uuid("tree_id")
			.notNull()
			.references(() => trees.id, { onDelete: "cascade" }),
		/**
		 * For directed kinds, A holds the role: A is B's mentor / teacher /
		 * godparent. For symmetric kinds the pair is stored id-sorted so the same
		 * friendship cannot be recorded twice. See `canonicalPair()`.
		 */
		personAId: uuid("person_a_id")
			.notNull()
			.references(() => people.id, { onDelete: "cascade" }),
		personBId: uuid("person_b_id")
			.notNull()
			.references(() => people.id, { onDelete: "cascade" }),
		kind: relationKindEnum("kind").notNull(),
		/** Overrides the generated label: "cousin" -> "second cousin, mother's side". */
		label: text("label"),
		/**
		 * 1..3, overriding the kind's default weight when the owner disagrees with it
		 * ("a colleague, but my closest one"). Null means "use the default", which is
		 * not the same as 1: it lets the default improve later without rewriting rows.
		 */
		closeness: integer("closeness"),
		/** Relations end. A past colleague is still worth recording. */
		startDate: date("start_date"),
		endDate: date("end_date"),
		note: text("note"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [
		// One row per (pair, kind): two people can be both cousins and colleagues,
		// but not cousins twice.
		uniqueIndex("person_relations_unique_idx").on(t.personAId, t.personBId, t.kind),
		index("person_relations_tree_idx").on(t.treeId),
		// Relations are read from both ends, so the reverse direction needs its own
		// index; the unique index above only serves lookups starting at A.
		index("person_relations_b_idx").on(t.personBId),
	],
);

/**
 * Contact details, one row per channel.
 *
 * A column-per-channel table (`phone`, `email`, `instagram`, ...) cannot hold
 * two phone numbers and needs a migration for every new platform. Rows also let
 * each detail carry its own visibility, which matters: someone may share an
 * email tree-wide but keep a home address to their own household.
 */
export const contactDetails = pgTable(
	"contact_details",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		personId: uuid("person_id")
			.notNull()
			.references(() => people.id, { onDelete: "cascade" }),
		kind: contactKindEnum("kind").notNull(),
		/**
		 * Stored as entered. Phone numbers are not normalised on write: relatives
		 * abroad have country codes, older records have landlines, and rewriting
		 * them loses information the owner deliberately typed.
		 */
		value: text("value").notNull(),
		/** "work", "home", "old number" -- free text, since the set is unbounded. */
		label: text("label"),
		visibility: visibilityEnum("visibility").notNull().default("tree"),
		/** The one to show on a collapsed card when several exist for a channel. */
		isPrimary: boolean("is_primary").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [
		index("contact_details_person_idx").on(t.personId),
		uniqueIndex("contact_details_unique_idx").on(t.personId, t.kind, t.value),
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
	contacts: many(contactDetails),
}));

export const contactDetailsRelations = relations(contactDetails, ({ one }) => ({
	person: one(people, { fields: [contactDetails.personId], references: [people.id] }),
}));

export const personRelationsRelations = relations(personRelations, ({ one }) => ({
	tree: one(trees, { fields: [personRelations.treeId], references: [trees.id] }),
	personA: one(people, { fields: [personRelations.personAId], references: [people.id] }),
	personB: one(people, { fields: [personRelations.personBId], references: [people.id] }),
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
export type PersonRelation = typeof personRelations.$inferSelect;
export type NewPersonRelation = typeof personRelations.$inferInsert;
export type RelationKind = (typeof relationKindEnum.enumValues)[number];
export type LivingStatus = (typeof livingStatusEnum.enumValues)[number];
export type Sex = (typeof sexEnum.enumValues)[number];
export type Verification = (typeof verificationEnum.enumValues)[number];
export type ContactDetail = typeof contactDetails.$inferSelect;
export type NewContactDetail = typeof contactDetails.$inferInsert;
export type ContactKind = (typeof contactKindEnum.enumValues)[number];
export type Visibility = (typeof visibilityEnum.enumValues)[number];
