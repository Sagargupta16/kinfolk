/**
 * Who may CHANGE a graph, as opposed to who may see one.
 *
 * Deliberately separate from `accessibleTrees()` in load.ts, which answers the read
 * question and grants `member` to anyone with a row. Writes need a narrower answer: a
 * `viewer` grant can see a graph and must not edit it, and a tree reached only through
 * an accepted person link must never be editable at all -- that link means "we agree
 * this is the same human", not "you may rewrite my records".
 *
 * Every mutation goes through `assertCanEdit()`. Reusing the read helper for writes is
 * the mistake this file exists to prevent, because it would silently let a linked
 * relative edit your side of the graph.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client";
import { people, treeMembers, trees, unions } from "../db/schema";

/** Roles that may write. `viewer` can read and is deliberately absent. */
const EDITOR_ROLES = ["owner", "editor"] as const;

/**
 * Thrown when a caller may not do what they asked.
 *
 * One error type rather than returning null, so a mutation that forgets to check
 * cannot silently succeed -- the throw is the failure mode, not a falsy value some
 * caller ignores.
 */
export class NotAllowedError extends Error {
	constructor(message = "You do not have permission to change this graph.") {
		super(message);
		this.name = "NotAllowedError";
	}
}

/** Tree ids this user may write to: owned, or held with an owner/editor grant. */
export async function editableTreeIds(userId: string): Promise<string[]> {
	const rows = await db
		.select({ id: trees.id })
		.from(trees)
		.leftJoin(treeMembers, and(eq(treeMembers.treeId, trees.id), eq(treeMembers.userId, userId)))
		.where(or(eq(trees.ownerId, userId), inArray(treeMembers.role, EDITOR_ROLES)));

	return [...new Set(rows.map((row) => row.id))];
}

/** Throws unless this user may write to this tree. */
export async function assertCanEditTree(userId: string, treeId: string): Promise<void> {
	const allowed = await editableTreeIds(userId);
	if (!allowed.includes(treeId)) throw new NotAllowedError();
}

/**
 * The tree a person belongs to, but only if this user may write to it.
 *
 * Returned rather than just checked, because almost every mutation needs the tree id
 * anyway (a new relation row carries one) and looking it up twice invites the two
 * lookups disagreeing.
 */
export async function treeIdForEditablePerson(userId: string, personId: string): Promise<string> {
	const [row] = await db
		.select({ treeId: people.treeId })
		.from(people)
		.where(eq(people.id, personId))
		.limit(1);
	if (!row) throw new NotAllowedError("That person no longer exists.");

	await assertCanEditTree(userId, row.treeId);
	return row.treeId;
}

/** Same, for a union. */
export async function treeIdForEditableUnion(userId: string, unionId: string): Promise<string> {
	const [row] = await db
		.select({ treeId: unions.treeId })
		.from(unions)
		.where(eq(unions.id, unionId))
		.limit(1);
	if (!row) throw new NotAllowedError("That partnership no longer exists.");

	await assertCanEditTree(userId, row.treeId);
	return row.treeId;
}

/**
 * Two people must live in the SAME tree to be joined by a union or a relation.
 *
 * Cross-tree connections are what `person_links` is for, and they need consent from
 * both sides. Writing a relation row that straddles two trees would create exactly the
 * unilateral cross-tree edge the link table exists to make impossible -- and neither
 * `unions` nor `person_relations` has anywhere to record the other family's agreement.
 */
export async function assertSameTree(personAId: string, personBId: string): Promise<string> {
	const rows = await db
		.select({ id: people.id, treeId: people.treeId })
		.from(people)
		.where(inArray(people.id, [personAId, personBId]));

	const [first, second] = rows;
	// Length AND both bindings: `rows.length === 2` does not narrow the destructured
	// elements for TypeScript, and a non-null assertion here would be asserting exactly
	// the thing this function exists to verify.
	if (!first || !second) throw new NotAllowedError("One of those people no longer exists.");
	if (first.treeId !== second.treeId) {
		throw new NotAllowedError(
			"Those two people are in different graphs. Propose a link instead, which needs both sides to agree.",
		);
	}
	return first.treeId;
}
