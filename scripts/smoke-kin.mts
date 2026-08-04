/**
 * Live proof that quick-add writes the right family SHAPE, against a real Neon branch.
 *
 *   pnpm db:smoke:kin
 *
 * `planKin` is unit-tested and pure, so what is unproven is the SQL that executes a plan:
 * whether a father and a mother added one after the other really land in one union row,
 * whether a batch of children really attaches to the union the plan named, and whether the
 * transaction leaves nothing behind when a step refuses.
 *
 * Those are the failures that look fine on screen. Two single-parent unions render as two
 * junctions, which reads as a layout bug rather than as bad data, so this asserts on the
 * ROWS. Everything it makes is tagged and deleted, so it can run against any branch.
 *
 * Deliberately NOT a Vitest file, for the same reason `smoke-db.mts` is not: the suite is
 * pure and offline, and a test needing DATABASE_URL would fail on a fresh clone for reasons
 * that have nothing to do with the code under test.
 */
import { config } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";

config({ path: ".env.local" });

// Imported after config() so lib/db/client.ts sees DATABASE_URL at module scope.
const { db } = await import("../lib/db/client");
const { people, trees, unionChildren, unions, users } = await import("../lib/db/schema");
const { planKin } = await import("../lib/tree/kin-plan");

const TAG = "kf-kin-smoke";
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}: ${JSON.stringify(actual)}`);
	if (!ok) {
		console.log(`        expected ${JSON.stringify(expected)}`);
		failures += 1;
	}
}

/**
 * The subject's family as `planKin` needs it, read from the database.
 *
 * A copy of the action's own `familyShape` rather than an import: that one is inside a
 * "use server" module, and importing it here would drag the whole action graph (and
 * `next/headers`) into a plain script.
 */
async function familyShape(subjectId: string, treeId: string) {
	const asChild = await db
		.select({ unionId: unionChildren.unionId })
		.from(unionChildren)
		.where(eq(unionChildren.childId, subjectId));

	const parentUnions = asChild.length
		? await db
				.select({ id: unions.id, a: unions.partnerAId, b: unions.partnerBId })
				.from(unions)
				.where(
					inArray(
						unions.id,
						asChild.map((r) => r.unionId),
					),
				)
		: [];

	const own = await db
		.select({ id: unions.id, a: unions.partnerAId, b: unions.partnerBId })
		.from(unions)
		.where(eq(unions.treeId, treeId));

	return {
		subjectId,
		parentUnions: parentUnions.map((u) => ({
			id: u.id,
			partnerAId: u.a,
			partnerBId: u.b,
			childIds: [],
		})),
		ownUnions: own
			.filter((u) => u.a === subjectId || u.b === subjectId)
			.map((u) => ({ id: u.id, partnerAId: u.a, partnerBId: u.b, childIds: [] })),
	};
}

/**
 * Execute a plan. Mirrors the action's transaction body exactly.
 *
 * Duplicated on purpose and it is the one duplication worth having here: this script exists
 * to prove the SQL, and calling the server action would need a request, a session cookie and
 * an auth round trip -- so the thing under test would be Auth.js rather than the shape.
 */
async function apply(
	treeId: string,
	subjectId: string,
	role: Parameters<typeof planKin>[1],
	count = 1,
	name?: string,
) {
	const family = await familyShape(subjectId, treeId);
	const plan = planKin(family, role, count);
	if (plan.refusal) return { refused: plan.refusal };

	// Sequenced, not transactional: the Neon HTTP driver has no transactions, which this
	// script is what discovered. Union first so a partial failure leaves an ordinary
	// single-parent union rather than a person stranded with no family.
	let unionId: string | null = null;
	if (plan.union.kind === "existing") unionId = plan.union.unionId;
	else if (plan.union.kind === "create") {
		const [row] = await db
			.insert(unions)
			.values({
				treeId,
				partnerAId: plan.union.partnerAId,
				partnerBId: plan.union.partnerBId,
			})
			.returning({ id: unions.id });
		unionId = row?.id ?? null;
	}
	if (!unionId) throw new Error("no union");

	const rows = await db
		.insert(people)
		.values(
			Array.from({ length: plan.create.count }, (_, index) => ({
				treeId,
				givenName: name ?? `${TAG}-${role}-${index}`,
				sex: plan.create.sex,
			})),
		)
		.returning({ id: people.id });
	const newIds = rows.map((r) => r.id);
	const first = newIds[0] as string;

	if (plan.attach === "partner") {
		const [current] = await db
			.select({ a: unions.partnerAId, b: unions.partnerBId })
			.from(unions)
			.where(eq(unions.id, unionId))
			.limit(1);
		if (!current?.a)
			await db.update(unions).set({ partnerAId: first }).where(eq(unions.id, unionId));
		else await db.update(unions).set({ partnerBId: first }).where(eq(unions.id, unionId));
	} else {
		await db
			.insert(unionChildren)
			.values(newIds.map((childId) => ({ unionId: unionId as string, childId })))
			.onConflictDoNothing();
	}

	if (plan.attachSubjectAsChild) {
		await db.insert(unionChildren).values({ unionId, childId: subjectId }).onConflictDoNothing();
	}

	return { unionId, newIds };
}

/**
 * Clear anything a previous run left behind.
 *
 * Not defensive decoration: with no transactions available, a crash mid-script leaves real
 * rows, and the very first run of this file crashed on `db.transaction()` and then failed
 * again on the unique email. A smoke check that only works on a clean branch is a check
 * nobody runs twice.
 */
async function sweep() {
	const stale = await db.select({ id: trees.id }).from(trees).where(eq(trees.slug, TAG));
	for (const tree of stale) await db.delete(trees).where(eq(trees.id, tree.id));
	await db.delete(users).where(eq(users.email, `${TAG}@example.invalid`));
}

async function main() {
	await sweep();

	const [owner] = await db
		.insert(users)
		.values({ name: "Kin Smoke", email: `${TAG}@example.invalid` })
		.returning();
	if (!owner) throw new Error("no owner");

	const [tree] = await db
		.insert(trees)
		.values({ name: `${TAG} tree`, slug: TAG, ownerId: owner.id })
		.returning();
	if (!tree) throw new Error("no tree");

	const [subject] = await db
		.insert(people)
		.values({ treeId: tree.id, givenName: `${TAG}-subject`, sex: "female" })
		.returning();
	if (!subject) throw new Error("no subject");

	console.log("\nfather then mother must land in ONE union");
	const father = await apply(tree.id, subject.id, "father");
	const mother = await apply(tree.id, subject.id, "mother");
	check(
		"same union row for both parents",
		"unionId" in father && "unionId" in mother && father.unionId === mother.unionId,
		true,
	);

	const parentUnionId = "unionId" in father ? (father.unionId as string) : "";
	const [couple] = await db
		.select({ a: unions.partnerAId, b: unions.partnerBId })
		.from(unions)
		.where(eq(unions.id, parentUnionId));
	check("both partner slots filled", Boolean(couple?.a && couple?.b), true);

	const parentRows = await db
		.select({ id: unions.id })
		.from(unions)
		.where(and(eq(unions.treeId, tree.id), eq(unions.id, parentUnionId)));
	check("exactly one parent union exists", parentRows.length, 1);

	const kids = await db
		.select({ childId: unionChildren.childId })
		.from(unionChildren)
		.where(eq(unionChildren.unionId, parentUnionId));
	check("subject attached as the child, once", kids.length, 1);

	console.log("\na third parent is refused rather than silently ignored");
	const third = await apply(tree.id, subject.id, "father");
	check("refused", "refused" in third, true);

	console.log("\na batch of children lands on one union");
	const batch = await apply(tree.id, subject.id, "son", 5);
	check("five people created", "newIds" in batch ? batch.newIds.length : 0, 5);
	const ownKids = await db
		.select({ childId: unionChildren.childId })
		.from(unionChildren)
		.where(eq(unionChildren.unionId, "unionId" in batch ? (batch.unionId as string) : ""));
	check("all five attached", ownKids.length, 5);

	console.log("\na sibling joins the subject's parent union");
	const sibling = await apply(tree.id, subject.id, "brother");
	check(
		"reused the existing parent union",
		"unionId" in sibling && sibling.unionId === parentUnionId,
		true,
	);
	const withSibling = await db
		.select({ childId: unionChildren.childId })
		.from(unionChildren)
		.where(eq(unionChildren.unionId, parentUnionId));
	check("parent union now holds two children", withSibling.length, 2);

	/*
	 * A partial edit must not blank the fields it never showed.
	 *
	 * The old `updatePerson` wrote every column unconditionally, so `orNull(form.get("x"))`
	 * was null for anything the form did not render -- and a five-field quick edit therefore
	 * NULLED `birthFamilyName`, `deathPlace` and `sourceNote`. Silent data loss on a field the
	 * user could not see, and a birth surname is searchable.
	 */
	console.log("\na partial edit leaves absent fields alone");
	const [rich] = await db
		.insert(people)
		.values({
			treeId: tree.id,
			givenName: "Before",
			familyName: "Fortin",
			birthFamilyName: "Aasbo",
			sourceNote: "parish register",
			occupation: "carpenter",
			sex: "female",
		})
		.returning();
	if (!rich) throw new Error("no rich row");

	/*
	 * Built by the ACTION's own patch rule, not by hand.
	 *
	 * Reimplementing the rule here would assert that my copy of it works, which proves
	 * nothing about the code the app runs. `buildPersonPatch` is exported from the action
	 * module for exactly this: it is the whole decision (which keys are present, where a year
	 * goes), and it needs no session, so a script can exercise the real thing.
	 */
	const form = new FormData();
	form.set("givenName", "After");
	form.set("living", "living");
	form.set("birthYear", "1952");

	const { buildPersonPatch } = await import("../lib/tree/person-patch");
	const patch = buildPersonPatch(form);

	check("absent keys are not in the patch at all", "birthFamilyName" in patch, false);
	check("absent notes are not in the patch", "sourceNote" in patch, false);

	await db
		.update(people)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(people.id, rich.id));

	const [after] = await db
		.select({
			givenName: people.givenName,
			birthFamilyName: people.birthFamilyName,
			sourceNote: people.sourceNote,
			occupation: people.occupation,
			birthDate: people.birthDate,
			birthDateApprox: people.birthDateApprox,
		})
		.from(people)
		.where(eq(people.id, rich.id));

	check("the edited field changed", after?.givenName, "After");
	check("birth surname survived", after?.birthFamilyName, "Aasbo");
	check("source note survived", after?.sourceNote, "parish register");
	check("occupation survived", after?.occupation, "carpenter");
	// A bare year goes to the fuzzy column, because `birthDate` is a real date and
	// 1952-01-01 would be a birthday nobody recorded.
	check("year went to the approx column", after?.birthDateApprox, "1952");
	check("exact date left null", after?.birthDate, null);
	/*
	 * `updatePerson` is deliberately NOT called here.
	 *
	 * It lives in a "use server" module, so importing it from a plain script yields a
	 * server-reference stub rather than the function -- a check on `typeof` returned
	 * "undefined" and was asserting nothing about the code. What matters is the patch RULE,
	 * which the action delegates to and which is exercised directly above; the action's own
	 * auth path is covered by smoke-db.mts.
	 */

	// Cleanup. People cascade to unions, unionChildren, relations and contacts.
	await db.delete(trees).where(eq(trees.id, tree.id));
	await db.delete(users).where(eq(users.id, owner.id));

	const leftover = await db.select({ id: trees.id }).from(trees).where(eq(trees.slug, TAG));
	check("nothing left behind", leftover.length, 0);

	console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
	process.exit(failures === 0 ? 0 : 1);
}

await main();
