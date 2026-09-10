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
import { and, eq, exists, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { sessionOrNull } from "@/auth";
import { db } from "../db/client";
import {
	contactDetails,
	contactKindEnum,
	livingStatusEnum,
	parentRoleEnum,
	people,
	personRelations,
	type RelationKind,
	type Sex,
	sexEnum,
	trees,
	unionChildren,
	unionStatusEnum,
	unions,
	visibilityEnum,
} from "../db/schema";
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
import { buildPersonPatch, oneOf } from "./person-patch";
import { reservePeopleBudget } from "./rate-limit";
import { canonicalPair, RELATION_KINDS } from "./relations";

export type Result =
	| { ok: true; id?: string }
	| { ok: false; error: string; confirmation?: "additional-relation" };

/**
 * The signed-in user id, or a refusal.
 *
 * Demo mode is rejected here rather than in each action: the demo is sample data with
 * no owner, so there is nothing to write to and no user to attribute it to. Doing this
 * check once means a new action cannot forget it.
 */
async function editor(): Promise<{ userId: string } | { error: string }> {
	const { cookies, headers } = await import("next/headers");
	const session = await sessionOrNull();
	const userId = session?.user?.id;
	if (userId) return { userId };

	// A bearer token, for the Pages-hosted UI: that origin cannot send this app's
	// cookie without it becoming SameSite=None, so the SPA authenticates its calls
	// with the session token instead (see lib/tree/bearer.ts). The cookie is tried
	// FIRST so the server-rendered path is untouched.
	const bearer = await userIdFromBearer((await headers()).get("authorization"));
	if (bearer) return { userId: bearer };

	const store = await cookies();
	if (store.get(DEMO_COOKIE)) {
		return { error: "This is sample data. Sign in to build your own graph." };
	}

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

		const sex = oneOf(form.get("sex"), sexEnum.enumValues, "unknown");
		if (!sex.ok) return { ok: false, error: "Choose a valid gender." };
		const living = oneOf(form.get("living"), livingStatusEnum.enumValues, "unknown");
		if (!living.ok) return { ok: false, error: "Choose a valid living status." };

		const budget = await reservePeopleBudget(treeId);
		if (!budget.ok) return budget;

		const [row] = await db
			.insert(people)
			.values({
				treeId,
				givenName,
				familyName,
				birthFamilyName: orNull(form.get("birthFamilyName")),
				nickname: orNull(form.get("nickname")),
				sex: sex.value,
				living: living.value,
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
	const parsedPatch = buildPersonPatch(form);
	if (!parsedPatch.ok) return parsedPatch;
	const { patch } = parsedPatch;

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
 * Detach the person's partner slots before deletion so the surviving parent's
 * partnership and child links remain. The whole operation is one HTTP transaction.
 */
export async function deletePerson(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const personId = String(form.get("personId") ?? "");
	if (!personId) return { ok: false, error: "Which person?" };

	try {
		const treeId = await treeIdForEditablePerson(auth.userId, personId);
		const deletable = exists(
			db
				.select({ id: people.id })
				.from(people)
				.where(and(eq(people.id, personId), isNull(people.claimedByUserId))),
		);
		const [, , , , , deleted] = await db.batch([
			db.select({ id: trees.id }).from(trees).where(eq(trees.id, treeId)).for("update"),
			db.select({ id: people.id }).from(people).where(eq(people.id, personId)).for("update"),
			db
				.update(unions)
				.set({ partnerAId: null })
				.where(and(eq(unions.partnerAId, personId), deletable)),
			db
				.update(unions)
				.set({ partnerBId: null })
				.where(and(eq(unions.partnerBId, personId), deletable)),
			db
				.update(trees)
				.set({ rootPersonId: null })
				.where(and(eq(trees.rootPersonId, personId), deletable)),
			db
				.delete(people)
				.where(and(eq(people.id, personId), isNull(people.claimedByUserId)))
				.returning({ id: people.id }),
		]);
		if (deleted.length === 0) {
			return {
				ok: false,
				error: "Profiles linked to an account cannot be deleted. You can edit their details.",
			};
		}
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
		const existing = await db
			.select({
				id: personRelations.id,
				personAId: personRelations.personAId,
				personBId: personRelations.personBId,
				kind: personRelations.kind,
			})
			.from(personRelations)
			.where(
				or(
					and(eq(personRelations.personAId, personAId), eq(personRelations.personBId, personBId)),
					and(eq(personRelations.personAId, personBId), eq(personRelations.personBId, personAId)),
				),
			);

		const duplicate = existing.find(
			(row) =>
				row.personAId === pair.personAId && row.personBId === pair.personBId && row.kind === kind,
		);
		if (duplicate) return { ok: true, id: duplicate.id };

		if (form.get("confirmAdditional") !== "true") {
			const immediateFamily = await areImmediateFamily(personAId, personBId, treeId);
			if (immediateFamily || existing.length > 0) {
				return {
					ok: false,
					error:
						"These people are already immediate family or have another recorded connection. Confirm that you want to add this separate connection too.",
					confirmation: "additional-relation",
				};
			}
		}

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

/** Whether two people already share an immediate structural family link. */
async function areImmediateFamily(
	personAId: string,
	personBId: string,
	treeId: string,
): Promise<boolean> {
	const [a, b] = await Promise.all([
		familyShape(personAId, treeId),
		familyShape(personBId, treeId),
	]);

	const includes = (union: FamilyShape["ownUnions"][number], personId: string) =>
		union.partnerAId === personId || union.partnerBId === personId;

	if (a.ownUnions.some((union) => includes(union, personBId))) return true;
	if (a.parentUnions.some((union) => includes(union, personBId))) return true;
	if (b.parentUnions.some((union) => includes(union, personAId))) return true;

	const aParentUnions = new Set(a.parentUnions.map((union) => union.id));
	return b.parentUnions.some((union) => aParentUnions.has(union.id));
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

		const status = oneOf(form.get("status"), unionStatusEnum.enumValues, "unknown");
		if (!status.ok) return { ok: false, error: "Choose a valid partnership status." };

		const [row] = await db
			.insert(unions)
			.values({
				treeId,
				partnerAId,
				partnerBId,
				status: status.value,
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

		const role = oneOf(form.get("role"), parentRoleEnum.enumValues, "biological");
		if (!role.ok) return { ok: false, error: "Choose a valid parent role." };

		// Serialize ancestry writes within this tree. The recursive check runs
		// after the lock in the same transaction, so concurrent attachments cannot
		// each validate an old graph and together create a cycle.
		const [, inserted] = await db.batch([
			db.select({ id: trees.id }).from(trees).where(eq(trees.id, unionTreeId)).for("update"),
			db.execute(sql`
				WITH RECURSIVE descendants(id) AS (
					SELECT ${childId}::uuid
					UNION
					SELECT uc.child_id
					FROM descendants d
					JOIN unions u ON u.tree_id = ${unionTreeId}::uuid
						AND (u.partner_a_id = d.id OR u.partner_b_id = d.id)
					JOIN union_children uc ON uc.union_id = u.id
				)
				INSERT INTO union_children (union_id, child_id, role)
				SELECT u.id, ${childId}::uuid, ${role.value}::parent_role
				FROM unions u
				WHERE u.id = ${unionId}::uuid AND u.tree_id = ${unionTreeId}::uuid
					AND NOT EXISTS (
						SELECT 1 FROM descendants d
						WHERE d.id = u.partner_a_id OR d.id = u.partner_b_id
					)
				ON CONFLICT DO NOTHING
				RETURNING child_id
			`),
		]);
		if (inserted.rowCount === 0) {
			const [existing] = await db
				.select({ childId: unionChildren.childId })
				.from(unionChildren)
				.where(and(eq(unionChildren.unionId, unionId), eq(unionChildren.childId, childId)))
				.limit(1);
			if (!existing)
				return {
					ok: false,
					error:
						"That would make somebody their own ancestor, or the family changed. Refresh and try again.",
				};
		}

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
	const value = orNull(form.get("value"));
	if (!personId || !value) return { ok: false, error: "A channel needs a value." };
	if (value.length > 2000 || (orNull(form.get("label"))?.length ?? 0) > 100) {
		return { ok: false, error: "Keep the value under 2,000 characters and the label under 100." };
	}

	const kind = oneOf(form.get("kind"), contactKindEnum.enumValues, null);
	// Refused rather than defaulted: silently recording a phone number under "other"
	// misfiles data the user typed on purpose, which is worse than asking again.
	if (!kind.ok || !kind.value) return { ok: false, error: "Pick a channel." };
	const visibility = oneOf(form.get("visibility"), visibilityEnum.enumValues, "tree");
	if (!visibility.ok) return { ok: false, error: "Choose who can see this detail." };

	try {
		await treeIdForEditablePerson(auth.userId, personId);

		await db
			.insert(contactDetails)
			.values({
				personId,
				kind: kind.value,
				value,
				label: orNull(form.get("label")),
				visibility: visibility.value,
			})
			.onConflictDoNothing();

		revalidatePath("/tree");
		return { ok: true };
	} catch (error) {
		return refuse(error);
	}
}

export async function updateContact(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };
	const contactId = String(form.get("contactId") ?? "");
	const value = orNull(form.get("value"));
	const label = orNull(form.get("label"));
	const kind = oneOf(form.get("kind"), contactKindEnum.enumValues, null);
	const visibility = oneOf(form.get("visibility"), visibilityEnum.enumValues, null);
	if (!contactId || !value || !kind.ok || !kind.value || !visibility.ok || !visibility.value) {
		return { ok: false, error: "Choose a channel, a value, and who may see it." };
	}
	if (value.length > 2000 || (label?.length ?? 0) > 100) {
		return { ok: false, error: "Keep the value under 2,000 characters and the label under 100." };
	}
	try {
		const [row] = await db
			.select({ personId: contactDetails.personId })
			.from(contactDetails)
			.where(eq(contactDetails.id, contactId))
			.limit(1);
		if (!row) return { ok: false, error: "That detail no longer exists." };
		await treeIdForEditablePerson(auth.userId, row.personId);
		const [duplicate] = await db
			.select({ id: contactDetails.id })
			.from(contactDetails)
			.where(
				and(
					eq(contactDetails.personId, row.personId),
					eq(contactDetails.kind, kind.value),
					eq(contactDetails.value, value),
				),
			)
			.limit(1);
		if (duplicate && duplicate.id !== contactId) {
			return { ok: false, error: "That channel and value are already recorded." };
		}
		await db
			.update(contactDetails)
			.set({ kind: kind.value, value, label, visibility: visibility.value, updatedAt: new Date() })
			.where(eq(contactDetails.id, contactId));
		revalidatePath("/tree");
		revalidatePath(`/contacts/${row.personId}`);
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
 * Neon HTTP supports atomic batches, although its interactive `db.transaction()`
 * API is unavailable. All dependent writes below commit or roll back together.
 */
export async function addRelative(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const subjectId = String(form.get("subjectId") ?? "");
	const role = String(form.get("role") ?? "") as KinRole;
	if (!subjectId) return { ok: false, error: "Which person?" };
	if (!Object.hasOwn(ROLE_SEX, role)) return { ok: false, error: "Pick a relationship." };

	const countRaw = Number(orNull(form.get("count")) ?? "1");
	const count = Number.isFinite(countRaw) ? countRaw : 1;

	try {
		const treeId = await treeIdForEditablePerson(auth.userId, subjectId);
		const { assertCanEditTree } = await import("./authz");
		await assertCanEditTree(auth.userId, treeId);

		const family = await familyShape(subjectId, treeId);
		const plan = planKin(family, role, count, orNull(form.get("unionId")));
		if (plan.refusal) return { ok: false, error: plan.refusal };
		if (plan.create.count === 0) return { ok: false, error: "Nothing to add." };

		// A name is optional here, unlike `addPerson`: a batch is created precisely because
		// nobody knows the names yet, so a numbered placeholder stands in until they do.
		const givenName = orNull(form.get("givenName"));
		const familyName = orNull(form.get("familyName"));
		const living = oneOf(form.get("living"), livingStatusEnum.enumValues, "unknown");
		if (!living.ok) return { ok: false, error: "Choose a valid living status." };
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
		let sex: Sex = roleSex;
		if (roleSex === "unknown") {
			const postedSex = oneOf(form.get("sex"), sexEnum.enumValues, "unknown");
			if (!postedSex.ok) return { ok: false, error: "Choose a valid gender." };
			sex = postedSex.value;
		}

		// How many children the target union already holds, so a second batch numbers on from
		// the first rather than producing two people called "Child 1".
		const offset =
			plan.attach === "child" && plan.union.kind === "existing"
				? await childCount(plan.union.unionId)
				: 0;

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
		let unionStatus: "married" | "partnered" | "unknown" = "unknown";
		if (plan.union.kind === "create") {
			const postedStatus = oneOf(
				form.get("unionStatus"),
				["married", "partnered", "unknown"] as const,
				"unknown",
			);
			if (!postedStatus.ok) {
				return { ok: false, error: "Choose a valid partnership status." };
			}
			unionStatus = postedStatus.value;
		}

		const budget = await reservePeopleBudget(treeId, plan.create.count);
		if (!budget.ok) return budget;

		const newPeople = Array.from({ length: plan.create.count }, (_, index) => ({
			id: crypto.randomUUID(),
			treeId,
			givenName:
				plan.create.count === 1 && givenName ? givenName : placeholderName(role, index, offset),
			familyName,
			sex,
			living: living.value,
			// A batch must not turn one supplied date into several people's birthday.
			birthDate: plan.create.count === 1 ? birth.birthDate : null,
			birthDateApprox: plan.create.count === 1 ? birth.birthDateApprox : null,
		}));
		const first = newPeople[0]?.id;
		if (!first) return { ok: false, error: "Could not add that person." };
		const insertPeople = db.insert(people).values(newPeople);

		if (plan.union.kind === "create") {
			const unionId = crypto.randomUUID();
			const partnerAId = plan.union.partnerAId ?? (plan.attach === "partner" ? first : null);
			const partnerBId =
				plan.attach === "partner" && plan.union.partnerAId ? first : plan.union.partnerBId;
			// A second request may have created the missing family after planning.
			// Check again under the same tree lock used by child attachment/deletion.
			const stillMissing = plan.attachSubjectAsChild
				? notExists(
						db
							.select({ id: unionChildren.unionId })
							.from(unionChildren)
							.where(eq(unionChildren.childId, subjectId)),
					)
				: plan.attach === "child"
					? notExists(
							db
								.select({ id: unions.id })
								.from(unions)
								.where(
									and(
										eq(unions.treeId, treeId),
										or(eq(unions.partnerAId, subjectId), eq(unions.partnerBId, subjectId)),
									),
								),
						)
					: sql`true`;
			const insertUnion = db.execute(sql`
				INSERT INTO unions (id, tree_id, partner_a_id, partner_b_id, status)
				SELECT ${unionId}::uuid, ${treeId}::uuid, ${partnerAId}::uuid,
					${partnerBId}::uuid, ${unionStatus}::union_status
				WHERE ${stillMissing}
				RETURNING id
			`);
			const childIds = [
				...(plan.attach === "child" ? newPeople.map((person) => person.id) : []),
				...(plan.attachSubjectAsChild ? [subjectId] : []),
			];
			const unionCreated = exists(
				db.select({ id: unions.id }).from(unions).where(eq(unions.id, unionId)),
			);
			const lockTree = db
				.select({ id: trees.id })
				.from(trees)
				.where(eq(trees.id, treeId))
				.for("update");
			const removeUnattached = db.delete(people).where(
				and(
					inArray(
						people.id,
						newPeople.map(({ id }) => id),
					),
					sql`not ${unionCreated}`,
				),
			);
			const [, , created] =
				childIds.length > 0
					? await db.batch([
							lockTree,
							insertPeople,
							insertUnion,
							db.execute(sql`
							INSERT INTO union_children (union_id, child_id)
							SELECT ${unionId}::uuid, child.id
							FROM (VALUES ${sql.join(
								childIds.map((id) => sql`(${id}::uuid)`),
								sql`, `,
							)}) AS child(id)
							WHERE ${unionCreated}
						`),
							removeUnattached,
						])
					: await db.batch([lockTree, insertPeople, insertUnion, removeUnattached]);
			if (created.rowCount === 0) {
				return { ok: false, error: "That family changed. Refresh and try again." };
			}
		} else if (plan.union.kind === "existing") {
			const unionId = plan.union.unionId;
			if (plan.attach === "child") {
				await db.batch([
					insertPeople,
					db.insert(unionChildren).values(newPeople.map(({ id }) => ({ unionId, childId: id }))),
				]);
			} else {
				// Claim either free slot in one update. A competing write cannot be overwritten.
				// If no slot remains, remove the unclaimed new row inside the same transaction.
				const [, attached] = await db.batch([
					insertPeople,
					db
						.update(unions)
						.set({
							partnerAId: sql`coalesce(${unions.partnerAId}, ${first}::uuid)`,
							partnerBId: sql`case when ${unions.partnerAId} is not null then coalesce(${unions.partnerBId}, ${first}::uuid) else ${unions.partnerBId} end`,
						})
						.where(
							and(
								eq(unions.id, unionId),
								eq(unions.treeId, treeId),
								or(isNull(unions.partnerAId), isNull(unions.partnerBId)),
							),
						)
						.returning({ id: unions.id }),
					db.delete(people).where(
						and(
							eq(people.id, first),
							notExists(
								db
									.select({ id: unions.id })
									.from(unions)
									.where(or(eq(unions.partnerAId, first), eq(unions.partnerBId, first))),
							),
						),
					),
				]);
				if (attached.length === 0)
					return { ok: false, error: "That family changed. Refresh and try again." };
			}
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
					.where(
						and(eq(unions.treeId, treeId), or(...parentUnionIds.map((id) => eq(unions.id, id)))),
					);

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
