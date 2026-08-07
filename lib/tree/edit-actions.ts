"use server";

/**
 * Every write the editor can perform.
 *
 * Server actions rather than API routes: the canvas is a client component but the
 * authorization, the validation and the insert all belong on the server, and an action
 * keeps them in one function instead of a route plus a fetch wrapper plus a shared type.
 *
 * Three rules hold for all of them, and each one is a thing the schema cannot enforce:
 *
 *   1. Authorization first, always, via lib/tree/authz.ts. A read grant is not a write
 *      grant, and a tree reached through an accepted person link is never editable.
 *   2. Demo mode cannot write. The demo has no user and no rows of its own, so a
 *      mutation would either fail confusingly or write into somebody's real graph.
 *   3. Relations go through `canonicalPair()`. It is what makes the unique index able
 *      to reject the same friendship recorded from either end.
 *
 * Each action returns a `Result` rather than throwing at the boundary, so a form can
 * show why something was refused. Genuine programming errors still throw.
 */
import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { sessionOrNull } from "@/auth";
import { db } from "../db/client";
import {
	type ContactKind,
	contactDetails,
	people,
	personRelations,
	type RelationKind,
	type Sex,
	unionChildren,
	unions,
	type Visibility,
} from "../db/schema";
import { wouldCreateAncestryCycle } from "./acyclic";
import { assertSameTree, NotAllowedError, treeIdForEditablePerson } from "./authz";
import { userIdFromBearer } from "./bearer";
import { DEMO_COOKIE } from "./demo";
import {
	birthYearColumns,
	type FamilyShape,
	type KinRole,
	placeholderName,
	planKin,
	ROLE_SEX,
} from "./kin-plan";
import { buildPersonPatch } from "./person-patch";
import { canonicalPair, RELATION_KINDS } from "./relations";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

/**
 * The signed-in user id, or a refusal.
 *
 * Demo mode is rejected here rather than in each action: the demo is sample data with
 * no owner, so there is nothing to write to and no user to attribute it to. Doing this
 * check once means a new action cannot forget it.
 */
async function editor(): Promise<{ userId: string } | { error: string }> {
	const { cookies, headers } = await import("next/headers");
	const store = await cookies();
	if (store.get(DEMO_COOKIE)) {
		return { error: "This is sample data. Sign in to build your own graph." };
	}

	const session = await sessionOrNull();
	const userId = session?.user?.id;
	if (userId) return { userId };

	// A bearer token, for the Pages-hosted UI: that origin cannot send this app's
	// cookie without it becoming SameSite=None, so the SPA authenticates its calls
	// with the session token instead (see lib/tree/bearer.ts). The cookie is tried
	// FIRST so the server-rendered path is untouched.
	const bearer = await userIdFromBearer((await headers()).get("authorization"));
	if (bearer) return { userId: bearer };

	return { error: "Sign in to make changes." };
}

/** Turns a thrown NotAllowedError into a message; anything else is a real bug. */
function refuse(error: unknown): Result {
	if (error instanceof NotAllowedError) return { ok: false, error: error.message };
	throw error;
}

/**
 * Empty string means "not recorded", which is not the same as an empty string in the
 * database. A form always posts a value, so this is where "" becomes null -- storing
 * the empty string would make `is null` checks miss half the unrecorded rows.
 */
function orNull(value: FormDataEntryValue | null): string | null {
	const text = typeof value === "string" ? value.trim() : "";
	return text.length > 0 ? text : null;
}

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Add a person to a graph.
 *
 * `sex` and `living` both default to the schema's own `unknown` when the form leaves
 * them alone, which is the honest value: genealogy is mostly incomplete data, and a
 * guess stored in a column outlives the guess.
 */
export async function addPerson(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const treeId = String(form.get("treeId") ?? "");
	if (!treeId) return { ok: false, error: "Which graph?" };

	const givenName = orNull(form.get("givenName"));
	const familyName = orNull(form.get("familyName"));
	if (!givenName && !familyName) {
		return { ok: false, error: "A person needs at least one name." };
	}

	try {
		const { assertCanEditTree } = await import("./authz");
		await assertCanEditTree(auth.userId, treeId);

		const [row] = await db
			.insert(people)
			.values({
				treeId,
				givenName,
				familyName,
				birthFamilyName: orNull(form.get("birthFamilyName")),
				nickname: orNull(form.get("nickname")),
				sex: (orNull(form.get("sex")) as Sex | null) ?? "unknown",
				living:
					(orNull(form.get("living")) as "living" | "deceased" | "unknown" | null) ?? "unknown",
				// A real date if it parses, otherwise the fuzzy text column. "about 1890" is
				// a genuine genealogical answer and must not be coerced into a false precision.
				birthDate: orNull(form.get("birthDate")),
				birthDateApprox: orNull(form.get("birthDateApprox")),
				birthPlace: orNull(form.get("birthPlace")),
				deathDate: orNull(form.get("deathDate")),
				deathDateApprox: orNull(form.get("deathDateApprox")),
				currentPlace: orNull(form.get("currentPlace")),
				occupation: orNull(form.get("occupation")),
				sourceNote: orNull(form.get("sourceNote")),
			})
			.returning({ id: people.id });

		revalidatePath("/tree");
		return { ok: true, id: row?.id };
	} catch (error) {
		return refuse(error);
	}
}

/**
 * Edit the fields of an existing person, patching only what the form actually sent.
 *
 * The previous version wrote every column unconditionally, which made it destructive in a
 * way nothing announced: `orNull(form.get("x"))` is null for a field the form never rendered,
 * so saving a five-field edit form NULLED `birthFamilyName`, `deathPlace` and `sourceNote` --
 * and a birth surname is searchable (see lib/tree/search.ts), so it was silent data loss on a
 * field the user could not even see.
 *
 * So absence and emptiness are now different things. A key that is not in the FormData is
 * left alone; a key present but blank is a deliberate erasure and writes null. That is the
 * only rule under which a partial form is safe, and it lets one action serve a compact
 * quick-edit and a full one without either being able to damage the other's fields.
 */
export async function updatePerson(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const personId = String(form.get("personId") ?? "");
	if (!personId) return { ok: false, error: "Which person?" };

	// The patch rule lives in lib/tree/person-patch.ts, where it is pure and asserted.
	// Absent keys are left alone; a key present but blank is a deliberate erasure.
	const patch = buildPersonPatch(form);

	if (Object.keys(patch).length === 0) return { ok: true, id: personId };

	try {
		await treeIdForEditablePerson(auth.userId, personId);

		await db
			.update(people)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(people.id, personId));

		revalidatePath("/tree");
		return { ok: true, id: personId };
	} catch (error) {
		return refuse(error);
	}
}

/**
 * Remove a person.
 *
 * Their unions, relations and contacts cascade (see the schema's foreign keys), so this
 * is one delete rather than a manual sweep -- and a manual sweep is what would drift
 * the day a new child table is added.
 */
export async function deletePerson(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const personId = String(form.get("personId") ?? "");
	if (!personId) return { ok: false, error: "Which person?" };

	try {
		await treeIdForEditablePerson(auth.userId, personId);
		await db.delete(people).where(eq(people.id, personId));
		revalidatePath("/tree");
		return { ok: true };
	} catch (error) {
		return refuse(error);
	}
}

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Connect two people with a named relation.
 *
 * Two invariants the database cannot express on its own:
 *
 *   - A self-relation is blocked here, because Drizzle cannot put a CHECK inside an
 *     index, so `personAId <> personBId` is the caller's job.
 *   - Symmetric kinds get id-sorted endpoints via `canonicalPair()`, which is what lets
 *     the unique index reject the same friendship entered from either side. Directed
 *     kinds keep caller order, because there A holds the role.
 */
export async function addRelation(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const personAId = String(form.get("personAId") ?? "");
	const personBId = String(form.get("personBId") ?? "");
	const kind = String(form.get("kind") ?? "") as RelationKind;

	if (!personAId || !personBId) return { ok: false, error: "Pick two people." };
	if (personAId === personBId) {
		return { ok: false, error: "A person cannot have a relation to themselves." };
	}
	if (!RELATION_KINDS[kind]) return { ok: false, error: "Pick a kind of relation." };

	try {
		const treeId = await assertSameTree(personAId, personBId);
		const { assertCanEditTree } = await import("./authz");
		await assertCanEditTree(auth.userId, treeId);

		const pair = canonicalPair(kind, personAId, personBId);
		const closenessRaw = orNull(form.get("closeness"));
		const closeness = closenessRaw ? Number(closenessRaw) : null;

		const [row] = await db
			.insert(personRelations)
			.values({
				treeId,
				...pair,
				kind,
				label: orNull(form.get("label")),
				// Null means "use the kind's default", which is deliberately not the same as
				// 1: it lets the default improve later without rewriting stored rows.
				closeness: closeness === 1 || closeness === 2 || closeness === 3 ? closeness : null,
				startDate: orNull(form.get("startDate")),
				endDate: orNull(form.get("endDate")),
				note: orNull(form.get("note")),
			})
			// The unique index on (A, B, kind) is the real guard. Two people can be both
			// cousins and colleagues, but not cousins twice, and a duplicate submit is a
			// no-op rather than an error the user has to understand.
			.onConflictDoNothing()
			.returning({ id: personRelations.id });

		revalidatePath("/tree");
		return { ok: true, id: row?.id };
	} catch (error) {
		return refuse(error);
	}
}

export async function deleteRelation(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const relationId = String(form.get("relationId") ?? "");
	if (!relationId) return { ok: false, error: "Which relation?" };

	try {
		const [row] = await db
			.select({ treeId: personRelations.treeId })
			.from(personRelations)
			.where(eq(personRelations.id, relationId))
			.limit(1);
		if (!row) return { ok: true };

		const { assertCanEditTree } = await import("./authz");
		await assertCanEditTree(auth.userId, row.treeId);

		await db.delete(personRelations).where(eq(personRelations.id, relationId));
		revalidatePath("/tree");
		return { ok: true };
	} catch (error) {
		return refuse(error);
	}
}

/* -------------------------------------------------------------------------- */
/* Family structure                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Record a partnership.
 *
 * Both partners are nullable in the schema so a single parent still forms a union, but
 * this action requires at least one: a union with neither partner is a junction joining
 * nothing, and it would render as an orphan dot.
 */
export async function addUnion(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const partnerAId = orNull(form.get("partnerAId"));
	const partnerBId = orNull(form.get("partnerBId"));
	if (!partnerAId && !partnerBId) return { ok: false, error: "Pick at least one partner." };
	if (partnerAId && partnerBId && partnerAId === partnerBId) {
		return { ok: false, error: "Those are the same person." };
	}

	try {
		// Both ends when there are two, so a cross-tree partnership is refused with the
		// message that explains person links; one end otherwise.
		const treeId =
			partnerAId && partnerBId
				? await assertSameTree(partnerAId, partnerBId)
				: await treeIdForEditablePerson(auth.userId, (partnerAId ?? partnerBId) as string);

		const { assertCanEditTree } = await import("./authz");
		await assertCanEditTree(auth.userId, treeId);

		const [row] = await db
			.insert(unions)
			.values({
				treeId,
				partnerAId,
				partnerBId,
				status:
					(orNull(form.get("status")) as
						| "partnered"
						| "married"
						| "separated"
						| "divorced"
						| "widowed"
						| "unknown"
						| null) ?? "unknown",
				startDate: orNull(form.get("startDate")),
				endDate: orNull(form.get("endDate")),
				place: orNull(form.get("place")),
			})
			.returning({ id: unions.id });

		revalidatePath("/tree");
		return { ok: true, id: row?.id };
	} catch (error) {
		return refuse(error);
	}
}

/**
 * Attach a child to a partnership.
 *
 * Parentage hangs off the union rather than off the child, which is what lets somebody
 * belong to two unions (birth and adoptive) without a special case anywhere. The
 * composite primary key stops the same child being added to one union twice.
 */
export async function addChild(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const unionId = String(form.get("unionId") ?? "");
	const childId = String(form.get("childId") ?? "");
	if (!unionId || !childId) return { ok: false, error: "Pick a partnership and a child." };

	try {
		const { treeIdForEditableUnion } = await import("./authz");
		const unionTreeId = await treeIdForEditableUnion(auth.userId, unionId);
		const childTreeId = await treeIdForEditablePerson(auth.userId, childId);
		if (unionTreeId !== childTreeId) {
			return { ok: false, error: "That child is in a different graph." };
		}

		// A child cannot be their own parent, and neither can a partner of the union they
		// are a child of -- the graph must stay acyclic or the layout has no generations.
		const [union] = await db
			.select({ a: unions.partnerAId, b: unions.partnerBId })
			.from(unions)
			.where(eq(unions.id, unionId))
			.limit(1);
		if (union && (union.a === childId || union.b === childId)) {
			return { ok: false, error: "Somebody cannot be their own parent." };
		}

		const ancestryRows = await db
			.select({
				childId: unionChildren.childId,
				partnerAId: unions.partnerAId,
				partnerBId: unions.partnerBId,
			})
			.from(unionChildren)
			.innerJoin(unions, eq(unionChildren.unionId, unions.id))
			.where(eq(unions.treeId, unionTreeId));
		const parentEdges = ancestryRows.flatMap((row) =>
			[row.partnerAId, row.partnerBId]
				.filter((parentId): parentId is string => parentId !== null)
				.map((parentId) => ({ parentId, childId: row.childId })),
		);
		const proposedParents = [union?.a, union?.b].filter(
			(parentId): parentId is string => parentId !== null && parentId !== undefined,
		);
		if (wouldCreateAncestryCycle(parentEdges, proposedParents, childId)) {
			return { ok: false, error: "That would make somebody their own ancestor." };
		}

		await db
			.insert(unionChildren)
			.values({
				unionId,
				childId,
				role:
					(orNull(form.get("role")) as
						| "biological"
						| "adoptive"
						| "step"
						| "foster"
						| "guardian"
						| null) ?? "biological",
			})
			.onConflictDoNothing();

		revalidatePath("/tree");
		return { ok: true };
	} catch (error) {
		return refuse(error);
	}
}

export async function removeChild(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const unionId = String(form.get("unionId") ?? "");
	const childId = String(form.get("childId") ?? "");
	if (!unionId || !childId) return { ok: false, error: "Which child?" };

	try {
		const { treeIdForEditableUnion } = await import("./authz");
		await treeIdForEditableUnion(auth.userId, unionId);
		await db
			.delete(unionChildren)
			.where(and(eq(unionChildren.unionId, unionId), eq(unionChildren.childId, childId)));
		revalidatePath("/tree");
		return { ok: true };
	} catch (error) {
		return refuse(error);
	}
}

/* -------------------------------------------------------------------------- */
/* Contact details                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Add a contact channel.
 *
 * Defaults to `tree` visibility -- the narrowest -- because a phone number is not
 * public just because a graph is shared, and widening has to be a deliberate act.
 * The value is stored EXACTLY as entered: relatives abroad have country codes and
 * older records have landlines, so normalising loses information somebody typed
 * on purpose.
 */
export async function addContact(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const personId = String(form.get("personId") ?? "");
	const kind = String(form.get("kind") ?? "") as ContactKind;
	const value = orNull(form.get("value"));
	if (!personId || !value) return { ok: false, error: "A channel needs a value." };

	try {
		await treeIdForEditablePerson(auth.userId, personId);

		await db
			.insert(contactDetails)
			.values({
				personId,
				kind,
				value,
				label: orNull(form.get("label")),
				visibility: (orNull(form.get("visibility")) as Visibility | null) ?? "tree",
			})
			.onConflictDoNothing();

		revalidatePath("/tree");
		return { ok: true };
	} catch (error) {
		return refuse(error);
	}
}

export async function deleteContact(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const contactId = String(form.get("contactId") ?? "");
	if (!contactId) return { ok: false, error: "Which detail?" };

	try {
		const [row] = await db
			.select({ personId: contactDetails.personId })
			.from(contactDetails)
			.where(eq(contactDetails.id, contactId))
			.limit(1);
		if (!row) return { ok: true };

		await treeIdForEditablePerson(auth.userId, row.personId);
		await db.delete(contactDetails).where(eq(contactDetails.id, contactId));
		revalidatePath("/tree");
		return { ok: true };
	} catch (error) {
		return refuse(error);
	}
}

/* -------------------------------------------------------------------------- */
/* Quick add                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Add a relative by ROLE: "X's father", "three of X's children".
 *
 * One action instead of the three-step journey the primitives above require, and the
 * difference is not only convenience. Recording a father and then a mother through
 * `addUnion` twice produces two single-parent unions, so the canvas draws two junctions and
 * the couple never appears -- a wrong shape that looks like a rendering bug. `planKin`
 * decides the structure from the role (see lib/tree/kin-plan.ts, where it is tested) and
 * this executes the plan.
 *
 * The whole thing is one transaction. A half-applied plan is the worst outcome available:
 * a person created with no union leaves somebody floating on the canvas with no way to tell
 * they were meant to be a father.
 */
export async function addRelative(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const subjectId = String(form.get("subjectId") ?? "");
	const role = String(form.get("role") ?? "") as KinRole;
	if (!subjectId) return { ok: false, error: "Which person?" };
	if (!ROLE_SEX[role]) return { ok: false, error: "Pick a relationship." };

	const countRaw = Number(orNull(form.get("count")) ?? "1");
	const count = Number.isFinite(countRaw) ? countRaw : 1;

	try {
		const treeId = await treeIdForEditablePerson(auth.userId, subjectId);
		const { assertCanEditTree } = await import("./authz");
		await assertCanEditTree(auth.userId, treeId);

		const family = await familyShape(subjectId, treeId);
		const plan = planKin(family, role, count);
		if (plan.refusal) return { ok: false, error: plan.refusal };
		if (plan.create.count === 0) return { ok: false, error: "Nothing to add." };

		// A name is optional here, unlike `addPerson`: a batch is created precisely because
		// nobody knows the names yet, so a numbered placeholder stands in until they do.
		const givenName = orNull(form.get("givenName"));
		const familyName = orNull(form.get("familyName"));
		const living =
			(orNull(form.get("living")) as "living" | "deceased" | "unknown" | null) ?? "unknown";
		const birth = birthYearColumns(String(orNull(form.get("birthYear")) ?? ""));

		/**
		 * A posted `sex` is honoured ONLY where the role implies nothing.
		 *
		 * "Father" is itself a statement about the person being added, so the form draws no
		 * gender field for it -- a picker there would exist only to contradict the button just
		 * pressed. But `partner`, `child` and `sibling` genuinely imply nothing, and without
		 * this those three were permanently `unknown` with no way to record what somebody knew.
		 *
		 * The guard is not politeness. `ROLE_SEX` wins whenever it is decided, so a `sex` key
		 * arriving alongside `role=father` cannot take effect: that field cannot exist in the
		 * form, so a value arriving anyway is a forged post rather than a user's choice.
		 */
		const roleSex = ROLE_SEX[role];
		const posted = orNull(form.get("sex")) as Sex | null;
		const sex: Sex = roleSex === "unknown" ? (posted ?? "unknown") : roleSex;

		// How many children the target union already holds, so a second batch numbers on from
		// the first rather than producing two people called "Child 1".
		const offset =
			plan.attach === "child" && plan.union.kind === "existing"
				? await childCount(plan.union.unionId)
				: 0;

		/*
		 * Sequenced rather than transactional, because the Neon HTTP driver has no transactions.
		 *
		 * Found by running this live: `db.transaction()` throws "No transactions support in
		 * neon-http driver" at runtime, so the first version of this action would have failed on
		 * every single use while type-checking perfectly.
		 *
		 * So the order is chosen to make a partial failure harmless. The UNION comes first, then
		 * the people, then the links -- because a union with an empty slot is an ordinary shape
		 * this app already renders (a single parent), while a person created with no union is
		 * somebody stranded on the canvas with nothing to say why they are there. Failing early
		 * leaves less mess than failing late.
		 */
		/*
		 * How the couple is recorded, honoured only when this add CREATES the union.
		 *
		 * The field exists on the partner form because the canvas now draws the fact --
		 * a solid bead for an intact partnership, the genogram double-slash for a
		 * divorce. An EXISTING union's status is that union's record and not this
		 * form's to overwrite, so `plan.union.kind === "existing"` ignores it. Parsed
		 * from an allow-list for the same reason invite roles are: a form value is a
		 * client value.
		 */
		const postedStatus = orNull(form.get("unionStatus"));
		const unionStatus: "married" | "partnered" | "unknown" =
			postedStatus === "married" || postedStatus === "partnered" ? postedStatus : "unknown";

		let unionId: string | null = null;
		if (plan.union.kind === "existing") {
			unionId = plan.union.unionId;
		} else if (plan.union.kind === "create") {
			const [row] = await db
				.insert(unions)
				.values({
					treeId,
					partnerAId: plan.union.partnerAId,
					partnerBId: plan.union.partnerBId,
					status: unionStatus,
				})
				.returning({ id: unions.id });
			unionId = row?.id ?? null;
		}
		if (!unionId) return { ok: false, error: "Could not record that partnership." };

		/*
		 * Re-read the slots before filling one.
		 *
		 * The plan was made from a shape loaded before any of this ran, so a concurrent write
		 * could have taken the slot in between. Checking here is what turns a lost update into a
		 * refusal the user can act on.
		 */
		if (plan.attach === "partner") {
			const [current] = await db
				.select({ a: unions.partnerAId, b: unions.partnerBId })
				.from(unions)
				.where(eq(unions.id, unionId))
				.limit(1);
			if (current?.a && current?.b) {
				return { ok: false, error: "Both parents are already recorded." };
			}
		}

		const rows = await db
			.insert(people)
			.values(
				Array.from({ length: plan.create.count }, (_, index) => ({
					treeId,
					// A typed name wins for a single add; a batch always numbers, because one name
					// repeated N times is worse than a placeholder -- the rows are then
					// indistinguishable from each other AND look deliberate.
					givenName:
						plan.create.count === 1 && givenName ? givenName : placeholderName(role, index, offset),
					// The surname is shared across a batch on purpose: siblings usually have one, and
					// it is the only field a batch can honestly prefill.
					familyName,
					// `sex` rather than `plan.create.sex`: the plan carries what the ROLE implies,
					// and for the three neutral roles the form is allowed to say more.
					sex,
					living,
					// Dates apply to one person only. Stamping a whole batch with one birth year
					// would assert that five children were born in the same year.
					birthDate: plan.create.count === 1 ? birth.birthDate : null,
					birthDateApprox: plan.create.count === 1 ? birth.birthDateApprox : null,
				})),
			)
			.returning({ id: people.id });

		const newIds = rows.map((row) => row.id);
		const first = newIds[0];
		if (!first) return { ok: false, error: "Could not add that person." };

		if (plan.attach === "partner") {
			// Whichever slot is free. Both-filled was already refused above.
			const [current] = await db
				.select({ a: unions.partnerAId, b: unions.partnerBId })
				.from(unions)
				.where(eq(unions.id, unionId))
				.limit(1);
			if (!current?.a) {
				await db.update(unions).set({ partnerAId: first }).where(eq(unions.id, unionId));
			} else {
				await db.update(unions).set({ partnerBId: first }).where(eq(unions.id, unionId));
			}
		} else {
			await db
				.insert(unionChildren)
				.values(newIds.map((childId) => ({ unionId: unionId as string, childId })))
				.onConflictDoNothing();
		}

		// A brand-new parent or sibling union needs the SUBJECT in it too, or the person just
		// added is a partner in a union the subject has nothing to do with.
		if (plan.attachSubjectAsChild) {
			await db.insert(unionChildren).values({ unionId, childId: subjectId }).onConflictDoNothing();
		}

		revalidatePath("/tree");
		return { ok: true, id: first };
	} catch (error) {
		return refuse(error);
	}
}

/**
 * The subject's family as the planner needs it.
 *
 * Two queries rather than a join: the planner wants unions grouped by the subject's ROLE in
 * them, and a single join would return one row per (union, child) pair for the caller to
 * regroup anyway.
 */
async function familyShape(subjectId: string, treeId: string): Promise<FamilyShape> {
	const [asChild, asPartner] = await Promise.all([
		db
			.select({ unionId: unionChildren.unionId })
			.from(unionChildren)
			.where(eq(unionChildren.childId, subjectId)),
		db
			.select({ id: unions.id, a: unions.partnerAId, b: unions.partnerBId })
			.from(unions)
			.where(
				and(
					eq(unions.treeId, treeId),
					or(eq(unions.partnerAId, subjectId), eq(unions.partnerBId, subjectId)),
				),
			),
	]);

	const parentUnionIds = asChild.map((row) => row.unionId);
	const parentUnions =
		parentUnionIds.length === 0
			? []
			: await db
					.select({ id: unions.id, a: unions.partnerAId, b: unions.partnerBId })
					.from(unions)
					.where(or(...parentUnionIds.map((id) => eq(unions.id, id))));

	return {
		subjectId,
		parentUnions: parentUnions.map((u) => ({
			id: u.id,
			partnerAId: u.a,
			partnerBId: u.b,
			childIds: [],
		})),
		ownUnions: asPartner.map((u) => ({
			id: u.id,
			partnerAId: u.a,
			partnerBId: u.b,
			childIds: [],
		})),
	};
}

/**
 * How many children a union already holds, for placeholder numbering.
 *
 * Counted in the database rather than read off the loaded `FamilyShape`: that shape carries
 * the unions the SUBJECT belongs to and does not enumerate their children, so trusting it
 * would silently return 0 and restart every batch at 1.
 */
async function childCount(unionId: string): Promise<number> {
	const rows = await db
		.select({ childId: unionChildren.childId })
		.from(unionChildren)
		.where(eq(unionChildren.unionId, unionId));
	return rows.length;
}

/**
 * Everybody in this viewer's editable graphs, for the person pickers.
 *
 * Names only -- no dates, no contacts. A picker needs to disambiguate two people, and
 * shipping whole rows to populate a dropdown would send contact values into the client
 * for people the viewer never opens.
 */
export async function editablePeople(): Promise<
	{ id: string; treeId: string; name: string; sex: Sex }[]
> {
	const auth = await editor();
	if ("error" in auth) return [];

	const { editableTreeIds } = await import("./authz");
	const treeIds = await editableTreeIds(auth.userId);
	if (treeIds.length === 0) return [];

	const rows = await db
		.select({
			id: people.id,
			treeId: people.treeId,
			givenName: people.givenName,
			familyName: people.familyName,
			nickname: people.nickname,
			sex: people.sex,
		})
		.from(people)
		.where(or(...treeIds.map((id) => eq(people.treeId, id))));

	return rows.map((row) => ({
		id: row.id,
		treeId: row.treeId,
		name: [row.givenName, row.familyName].filter(Boolean).join(" ") || row.nickname || "Unknown",
		sex: row.sex,
	}));
}
