/**
 * The real data source: load a signed-in user's trees out of Postgres and
 * project them through the same pipeline the demo uses.
 *
 * Server-only. Contact details are filtered HERE, before anything is returned,
 * because this function is the boundary where private rows would otherwise cross
 * into a client component. See visibility.ts for the ladder.
 *
 * Read path, in order:
 *   1. which trees may this user see, and at what access level
 *   2. their people, unions, union children, relations, contacts
 *   3. accepted person links among the people actually loaded
 *   4. fuse, project, done
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client";
import {
	contactDetails,
	people,
	personLinks,
	personRelations,
	treeMembers,
	trees,
	unionChildren,
	unions,
} from "../db/schema";
import { fuseTrees, type TreeSlice, toFlowGraph, type UnionWithChildren } from "./graph";
import type { TreeView } from "./view";
import { filterContacts, type ViewerAccess } from "./visibility";

export type LoadOptions = {
	/** False loads only the user's own trees, dropping linked relatives. */
	combined?: boolean;
	/** False hides the social overlay. */
	showRelations?: boolean;
};

/**
 * Trees this user can reach, with the access level that governs contact
 * visibility. Ownership outranks a membership row, and an explicit member grant
 * outranks nothing else -- absence of a row means no access at all.
 */
async function accessibleTrees(userId: string): Promise<Map<string, ViewerAccess>> {
	const rows = await db
		.select({ id: trees.id, ownerId: trees.ownerId, memberUserId: treeMembers.userId })
		.from(trees)
		.leftJoin(treeMembers, and(eq(treeMembers.treeId, trees.id), eq(treeMembers.userId, userId)))
		.where(or(eq(trees.ownerId, userId), eq(treeMembers.userId, userId)));

	const access = new Map<string, ViewerAccess>();
	for (const row of rows) {
		// Owner or explicit member: both see the tree's own private details.
		access.set(row.id, "member");
	}
	return access;
}

/** Everything one set of trees contains, in the shape `fuseTrees` expects. */
async function loadSlices(treeIds: string[]): Promise<TreeSlice[]> {
	if (treeIds.length === 0) return [];

	const [treeRows, personRows, unionRows, childRows, relationRows] = await Promise.all([
		db.select().from(trees).where(inArray(trees.id, treeIds)),
		db.select().from(people).where(inArray(people.treeId, treeIds)),
		db.select().from(unions).where(inArray(unions.treeId, treeIds)),
		// union_children has no treeId, so it is reached through its unions.
		db
			.select({
				unionId: unionChildren.unionId,
				childId: unionChildren.childId,
				treeId: unions.treeId,
			})
			.from(unionChildren)
			.innerJoin(unions, eq(unions.id, unionChildren.unionId))
			.where(inArray(unions.treeId, treeIds)),
		db.select().from(personRelations).where(inArray(personRelations.treeId, treeIds)),
	]);

	const childIdsByUnion = new Map<string, string[]>();
	for (const row of childRows) {
		const existing = childIdsByUnion.get(row.unionId);
		if (existing) existing.push(row.childId);
		else childIdsByUnion.set(row.unionId, [row.childId]);
	}

	const personIds = personRows.map((person) => person.id);
	const contactRows =
		personIds.length > 0
			? await db.select().from(contactDetails).where(inArray(contactDetails.personId, personIds))
			: [];

	const contactsByPerson = new Map<string, typeof contactRows>();
	for (const row of contactRows) {
		const existing = contactsByPerson.get(row.personId);
		if (existing) existing.push(row);
		else contactsByPerson.set(row.personId, [row]);
	}

	return treeRows.map((tree) => {
		const treePeople = personRows.filter((person) => person.treeId === tree.id);
		const contacts: Record<string, typeof contactRows> = {};
		for (const person of treePeople) {
			const details = contactsByPerson.get(person.id);
			if (details) contacts[person.id] = details;
		}

		return {
			treeId: tree.id,
			treeName: tree.name,
			people: treePeople,
			unions: unionRows
				.filter((union) => union.treeId === tree.id)
				.map<UnionWithChildren>((union) => ({
					...union,
					childIds: childIdsByUnion.get(union.id) ?? [],
				})),
			relations: relationRows.filter((relation) => relation.treeId === tree.id),
			contacts,
		};
	});
}

/**
 * Accepted links touching the given people.
 *
 * Only `accepted` rows are fetched: a pending proposal must never change what
 * anyone sees, which is the invariant `fuseTrees` relies on its callers to keep.
 */
async function acceptedLinks(personIds: string[]) {
	if (personIds.length === 0) return [];

	return db
		.select({ personAId: personLinks.personAId, personBId: personLinks.personBId })
		.from(personLinks)
		.where(
			and(
				eq(personLinks.status, "accepted"),
				or(inArray(personLinks.personAId, personIds), inArray(personLinks.personBId, personIds)),
			),
		);
}

/**
 * Build the signed-in view for a user.
 *
 * Returns null when the user has no tree yet, which the caller turns into an
 * empty state rather than an error -- a brand new account is a normal condition,
 * not a failure.
 */
export async function loadTreeView(
	userId: string,
	{ combined = true, showRelations = true }: LoadOptions = {},
): Promise<TreeView | null> {
	const access = await accessibleTrees(userId);
	if (access.size === 0) return null;

	const ownTreeIds = [...access.keys()];
	const ownSlices = await loadSlices(ownTreeIds);
	const ownPersonIds = ownSlices.flatMap((slice) => slice.people.map((person) => person.id));

	const links = combined ? await acceptedLinks(ownPersonIds) : [];

	// A link's far end usually lives in a tree this user has no grant on. Those
	// trees are loaded so the graph can join up, but at `linked` access, so their
	// tree-private contacts stay out of the response.
	const ownPersonIdSet = new Set(ownPersonIds);
	const foreignPersonIds = links
		.flatMap((link) => [link.personAId, link.personBId])
		.filter((id) => !ownPersonIdSet.has(id));

	let slices = ownSlices;
	if (foreignPersonIds.length > 0) {
		const foreignTreeIds = await db
			.selectDistinct({ treeId: people.treeId })
			.from(people)
			.where(inArray(people.id, foreignPersonIds));

		const extraTreeIds = foreignTreeIds
			.map((row) => row.treeId)
			.filter((treeId) => !access.has(treeId));

		for (const treeId of extraTreeIds) access.set(treeId, "linked");
		if (extraTreeIds.length > 0) slices = [...ownSlices, ...(await loadSlices(extraTreeIds))];
	}

	// Contact filtering, before any row leaves the server.
	const treeIdByPersonId = new Map<string, string>();
	for (const slice of slices) {
		for (const person of slice.people) treeIdByPersonId.set(person.id, slice.treeId);
	}

	const filtered = slices.map((slice) => ({
		...slice,
		contacts: filterContacts(slice.contacts ?? {}, treeIdByPersonId, access),
	}));

	const primaryTreeId = ownTreeIds[0];
	const fused = fuseTrees(filtered, links, primaryTreeId);
	const { nodes, edges } = toFlowGraph(fused);

	// The viewer's own card, when they have claimed a person row.
	const selfId = fused.people.find((person) =>
		person.sources.some((source) => source.claimedByUserId === userId),
	)?.id;

	return {
		nodes,
		edges,
		selfId,
		treeNames: filtered.map((slice) => slice.treeName),
		isDemo: false,
		isCombined: combined,
		showRelations,
		stats: {
			people: fused.people.length,
			rows: filtered.reduce((total, slice) => total + slice.people.length, 0),
			merged: fused.people.filter((person) => person.sources.length > 1).length,
			relations: fused.relations.length,
			trees: filtered.length,
		},
	};
}
