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
import { assertSameTree, NotAllowedError, treeIdForEditablePerson } from "./authz";
import { DEMO_COOKIE } from "./demo";
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
	const { cookies } = await import("next/headers");
	const store = await cookies();
	if (store.get(DEMO_COOKIE)) {
		return { error: "This is sample data. Sign in to build your own graph." };
	}

	const session = await sessionOrNull();
	const userId = session?.user?.id;
	if (!userId) return { error: "Sign in to make changes." };
	return { userId };
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

/** Edit the fields of an existing person. */
export async function updatePerson(form: FormData): Promise<Result> {
	const auth = await editor();
	if ("error" in auth) return { ok: false, error: auth.error };

	const personId = String(form.get("personId") ?? "");
	if (!personId) return { ok: false, error: "Which person?" };

	try {
		await treeIdForEditablePerson(auth.userId, personId);

		await db
			.update(people)
			.set({
				givenName: orNull(form.get("givenName")),
				familyName: orNull(form.get("familyName")),
				nickname: orNull(form.get("nickname")),
				sex: (orNull(form.get("sex")) as Sex | null) ?? "unknown",
				living:
					(orNull(form.get("living")) as "living" | "deceased" | "unknown" | null) ?? "unknown",
				birthDate: orNull(form.get("birthDate")),
				birthDateApprox: orNull(form.get("birthDateApprox")),
				birthPlace: orNull(form.get("birthPlace")),
				deathDate: orNull(form.get("deathDate")),
				deathDateApprox: orNull(form.get("deathDateApprox")),
				currentPlace: orNull(form.get("currentPlace")),
				occupation: orNull(form.get("occupation")),
				updatedAt: new Date(),
			})
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
