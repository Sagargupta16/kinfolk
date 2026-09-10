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
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
	contactDetails,
	type ParentRole,
	people,
	personRelations,
	trees,
	unionChildren,
	unions,
} from "../db/schema";
import { editableTreeIds } from "./authz";
import { fuseTrees, type TreeSlice, toFlowGraph, type UnionWithChildren } from "./graph";
import { kinshipMap } from "./kinship";
import { treeAccessForUser } from "./read-access";
import type { TreeView } from "./view";
import { filterContacts } from "./visibility";

export type LoadOptions = {
	/** False loads only the user's own trees, dropping linked relatives. */
	combined?: boolean;
	/** False hides the social overlay. */
	showRelations?: boolean;
	/**
	 * Who is signed in, passed through onto the view for the account menu.
	 *
	 * Threaded in by the page rather than looked up here: the caller already has the
	 * session, and a second query for a name this function was handed would be work for
	 * an answer it was given.
	 */
	viewer?: { name: string | null; email: string | null } | null;
};

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
				role: unionChildren.role,
				treeId: unions.treeId,
			})
			.from(unionChildren)
			.innerJoin(unions, eq(unions.id, unionChildren.unionId))
			.where(inArray(unions.treeId, treeIds)),
		db.select().from(personRelations).where(inArray(personRelations.treeId, treeIds)),
	]);

	const childIdsByUnion = new Map<string, string[]>();
	const childRolesByUnion = new Map<string, Record<string, ParentRole[]>>();
	for (const row of childRows) {
		const existing = childIdsByUnion.get(row.unionId);
		if (existing) existing.push(row.childId);
		else childIdsByUnion.set(row.unionId, [row.childId]);
		const roles = childRolesByUnion.get(row.unionId) ?? {};
		roles[row.childId] = [row.role];
		childRolesByUnion.set(row.unionId, roles);
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

	return treeRows
		.sort((a, b) => treeIds.indexOf(a.id) - treeIds.indexOf(b.id))
		.map((tree) => {
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
						childRoles: childRolesByUnion.get(union.id) ?? {},
					})),
				relations: relationRows.filter((relation) => relation.treeId === tree.id),
				contacts,
			};
		});
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
	{ combined = true, showRelations = true, viewer = null }: LoadOptions = {},
): Promise<TreeView | null> {
	const { access, links } = await treeAccessForUser(userId, combined);
	if (access.size === 0) return null;

	const ownTreeIds = [...access].filter(([, level]) => level === "member").map(([id]) => id);
	const slices = await loadSlices([...access.keys()]);

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

	// Which graph the Add panel writes into. The viewer's OWN first tree, never a linked
	// one: an accepted person link means "we agree this is the same human", not "you may
	// edit my records". Recomputed rather than assumed from `access`, because that map
	// grants `member` for reading and says nothing about write grants.
	const writable = await editableTreeIds(userId);
	const writableTreeIds = ownTreeIds.filter((id) => writable.includes(id));
	const editableTreeId = writableTreeIds[0] ?? null;

	return {
		nodes,
		edges,
		selfId,
		// Already a fused id, so no `fusedSelfId` hop: it came out of `fused.people`.
		kinship: kinshipMap(fused, selfId),
		treeNames: filtered.map((slice) => slice.treeName),
		isDemo: false,
		editableTreeId,
		editableTreeIds: writableTreeIds,
		editableTrees: writableTreeIds.map((id) => ({
			id,
			name: slices.find((slice) => slice.treeId === id)?.treeName ?? "Family tree",
		})),
		editableUnions: slices.flatMap((slice) =>
			writableTreeIds.includes(slice.treeId) ? slice.unions : [],
		),
		viewer,
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
