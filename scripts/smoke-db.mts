/**
 * Live proof that the database read path works, against a real Neon branch.
 *
 *   pnpm db:smoke
 *
 * `loadTreeView()` was previously covered by types and unit tests only -- every
 * live check had gone through the demo path, which never touches Postgres. This
 * seeds two small trees, links a person across them, reads the view back through
 * the real query path, asserts the interesting invariants, and deletes everything
 * it made. It is a throwaway check, not a fixture: nothing is left behind, so it
 * can run against any branch without leaving state for the next run to trip on.
 *
 * Deliberately NOT a Vitest file. The rest of the suite is pure and offline; a
 * test that needs DATABASE_URL would fail on a fresh clone and in CI for reasons
 * that have nothing to do with the code under test.
 */
import { config } from "dotenv";
import { and, eq, inArray, or } from "drizzle-orm";

config({ path: ".env.local" });

// Imported after config() so lib/db/client.ts sees DATABASE_URL at module scope.
const { db } = await import("../lib/db/client");
const {
	contactDetails,
	people,
	personLinks,
	personRelations,
	trees,
	unionChildren,
	unions,
	users,
} = await import("../lib/db/schema");
const { loadTreeView } = await import("../lib/tree/load");

/** Marks every row this script creates, so cleanup can find them all. */
const TAG = "kf-smoke";

function check(label: string, actual: unknown, expected: unknown) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}: ${JSON.stringify(actual)}`);
	if (!ok) {
		console.log(`        expected ${JSON.stringify(expected)}`);
		failures++;
	}
}

let failures = 0;

async function seed() {
	const [me] = await db
		.insert(users)
		.values({ name: "Smoke Owner", email: `${TAG}-owner@example.invalid` })
		.returning();
	const [other] = await db
		.insert(users)
		.values({ name: "Smoke Cousin", email: `${TAG}-cousin@example.invalid` })
		.returning();

	const [mine] = await db
		.insert(trees)
		.values({ name: "Smoke line", slug: `${TAG}-mine`, ownerId: me.id })
		.returning();
	const [theirs] = await db
		.insert(trees)
		.values({ name: "Smoke branch", slug: `${TAG}-theirs`, ownerId: other.id })
		.returning();

	// My tree: a couple, their child (me), and a friend with no family at all --
	// the anchorFamilylessNodes case.
	const [gran, gramps, self, friend] = await db
		.insert(people)
		.values([
			{ treeId: mine.id, givenName: "Ada", familyName: "Smoke", sex: "female", living: "deceased" },
			{ treeId: mine.id, givenName: "Bert", familyName: "Smoke", sex: "male", living: "deceased" },
			{
				treeId: mine.id,
				givenName: "Cass",
				familyName: "Smoke",
				sex: "other",
				living: "living",
				claimedByUserId: me.id,
			},
			{ treeId: mine.id, givenName: "Dee", familyName: "Neighbour", living: "living" },
		])
		.returning();

	const [marriage] = await db
		.insert(unions)
		.values({ treeId: mine.id, partnerAId: gran.id, partnerBId: gramps.id, status: "married" })
		.returning();
	await db.insert(unionChildren).values({ unionId: marriage.id, childId: self.id });

	await db
		.insert(personRelations)
		.values({ treeId: mine.id, personAId: self.id, personBId: friend.id, kind: "friend" });

	// The two ends of the visibility ladder, to prove filterContacts runs: "shared"
	// reaches any viewer with access, "tree" only the owning tree's members.
	await db.insert(contactDetails).values([
		{ personId: self.id, kind: "email", value: `${TAG}@example.invalid`, visibility: "shared" },
		{ personId: self.id, kind: "phone", value: "+44 7700 900000", visibility: "tree" },
	]);

	// Their tree records Ada too: the same woman, two independent claims.
	const [theirAda] = await db
		.insert(people)
		.values([
			{
				treeId: theirs.id,
				givenName: "Ada",
				familyName: "Smoke",
				sex: "female",
				living: "deceased",
			},
			{ treeId: theirs.id, givenName: "Eve", familyName: "Branch", living: "living" },
		])
		.returning();

	await db.insert(personLinks).values({
		personAId: gran.id,
		personBId: theirAda.id,
		status: "accepted",
		proposedById: me.id,
	});

	// A pending link must never change what anyone sees.
	await db.insert(personLinks).values({
		personAId: self.id,
		personBId: theirAda.id,
		status: "pending",
		proposedById: me.id,
	});

	return { meId: me.id, otherId: other.id, selfPersonId: self.id };
}

async function cleanup() {
	const rows = await db
		.select({ id: users.id })
		.from(users)
		.where(
			// Both seeded users, matched on the tag rather than remembered ids, so a
			// half-finished earlier run still gets swept.
			or(
				eq(users.email, `${TAG}-owner@example.invalid`),
				eq(users.email, `${TAG}-cousin@example.invalid`),
			),
		);
	if (rows.length === 0) return 0;

	// person_links has no tree_id and no cascade from users, so it goes first.
	const treeRows = await db
		.select({ id: trees.id })
		.from(trees)
		.where(
			inArray(
				trees.ownerId,
				rows.map((row) => row.id),
			),
		);
	if (treeRows.length > 0) {
		const personRows = await db
			.select({ id: people.id })
			.from(people)
			.where(
				inArray(
					people.treeId,
					treeRows.map((row) => row.id),
				),
			);
		const personIds = personRows.map((row) => row.id);
		if (personIds.length > 0) {
			await db
				.delete(personLinks)
				.where(
					or(inArray(personLinks.personAId, personIds), inArray(personLinks.personBId, personIds)),
				);
		}
	}

	// users -> trees -> people -> unions/relations/contacts all cascade.
	await db.delete(users).where(
		inArray(
			users.id,
			rows.map((row) => row.id),
		),
	);
	return rows.length;
}

console.log("cleaning any leftovers from a previous run...");
console.log(`  removed ${await cleanup()} user(s)`);

console.log("seeding...");
const { meId, otherId, selfPersonId } = await seed();

try {
	console.log("combined view:");
	const combined = await loadTreeView(meId);
	if (!combined) throw new Error("loadTreeView returned null for a user with a tree");

	check("trees reached", combined.stats.trees, 2);
	check("person rows", combined.stats.rows, 6);
	// Ada is one person with two records, so fusion drops the count by one.
	check("people after fusion", combined.stats.people, 5);
	check("merged", combined.stats.merged, 1);
	check("relations", combined.stats.relations, 1);
	check("not demo", combined.isDemo, false);

	const selfNode = combined.nodes.find((node) => node.id === combined.selfId);
	check("self resolved", selfNode?.type, "person");
	// kinship is a Map, not a record (view.ts) -- bracket access reads undefined for
	// every id, which is the false pass this line first had.
	check("viewer is labelled", combined.kinship.get(combined.selfId ?? "")?.label, "you");
	check("viewer's term is via self", combined.kinship.get(combined.selfId ?? "")?.via, "self");

	const ada = combined.nodes.find(
		(node) => node.type === "person" && node.data.primary?.givenName === "Ada",
	);
	check("Ada carries two source records", ada?.data.contributingTreeIds?.length, 2);
	// Ada partners the union whose child is the viewer, so she is one rung up.
	// Gendered because her stored sex is "female"; an "unknown" row would read "parent".
	check("Ada is the viewer's mother", combined.kinship.get(ada?.id ?? "")?.label, "mother");
	check("proven by the walk, not inferred", combined.kinship.get(ada?.id ?? "")?.via, "blood");

	const contacts = selfNode?.data.contacts ?? [];
	check("owner sees both own channels", contacts.length, 2);

	console.log("mine-only view:");
	const mineOnly = await loadTreeView(meId, { combined: false });
	check("one tree", mineOnly?.stats.trees, 1);
	check("nothing merged", mineOnly?.stats.merged, 0);
	check("four people", mineOnly?.stats.people, 4);

	console.log("relations off:");
	const noRelations = await loadTreeView(meId, { showRelations: false });
	check("flag threaded through", noRelations?.showRelations, false);

	console.log("a user with no tree:");
	const [stranger] = await db
		.insert(users)
		.values({ name: "Nobody", email: `${TAG}-stranger@example.invalid` })
		.returning();
	check("returns null, not an error", await loadTreeView(stranger.id), null);
	await db.delete(users).where(eq(users.id, stranger.id));

	console.log("the far tree's owner sees it from their side:");
	const fromTheirs = await loadTreeView(otherId);
	// Two, not one: an accepted link is symmetric, so their view pulls my tree in at
	// "linked" access so the graph can join up. That is the product working, and the
	// check that matters is the one below -- the far tree comes in WITHOUT its
	// tree-private contacts.
	check("the linked tree is pulled in from their side too", fromTheirs?.stats.trees, 2);
	check("and Ada is merged for them as well", fromTheirs?.stats.merged, 1);
	check(
		"the viewer's private phone never reaches them",
		fromTheirs?.nodes.some((node) =>
			(node.data.contacts ?? []).some((contact: { value: string }) =>
				contact.value.includes("7700"),
			),
		),
		false,
	);

	// The pending link must not have fused anything.
	const pending = await db
		.select({ id: personLinks.id })
		.from(personLinks)
		.where(and(eq(personLinks.personAId, selfPersonId), eq(personLinks.status, "pending")));
	check("pending link still stored", pending.length, 1);
	check("pending link changed nothing", combined.stats.merged, 1);
} finally {
	console.log("cleaning up...");
	console.log(`  removed ${await cleanup()} user(s)`);
}

console.log(failures === 0 ? "\nall live checks passed" : `\n${failures} live check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
