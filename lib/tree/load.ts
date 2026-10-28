/**
 * The real data source: load a signed-in user's trees out of Postgres and
 * project them through the same pipeline the demo uses.
 *
 * Server-only. Contact details are filtered HERE, before anything is returned,
 * because this function is the boundary where private rows would otherwise cross
 * into a client component. See visibility.ts for the ladder.
 *
 * Read path, in order:
 *   1. which trees may this user see, at what access level, and through which accepted
 *      person links -- asked alongside which trees they may write to
 *   2. their people, unions, union children, relations, contacts, all at once
 *   3. fuse, project, done
 *
 * Three round trips, because every query that does not need another's answer is sent with
 * it: the read and write grants are independent, and contacts are reached through their
 * people's tree rather than through the people rows, so they need not wait for them.
 */
import { eq, getTableColumns, inArray } from "drizzle-orm";
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

type LoadOptions = {
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

	/*
	 * Rows that feed the layout come back in ENTRY order, oldest first and then by id.
	 *
	 * Without an ORDER BY, Postgres returns a heap in physical order, and an UPDATE writes a
	 * new row version wherever there is room -- so renaming somebody could move them along
	 * their row of siblings, and a friend could be anchored beside a different contact after an
	 * unrelated edit. The layout breaks its own ties by entry order too; this keeps everything
	 * else that walks these lists in arrival order (union children, relation anchors) stable.
	 */
	const [treeRows, personRows, unionRows, childRows, relationRows, contactRows] = await Promise.all(
		[
			db.select().from(trees).where(inArray(trees.id, treeIds)),
			db
				.select()
				.from(people)
				.where(inArray(people.treeId, treeIds))
				.orderBy(people.createdAt, people.id),
			db
				.select()
				.from(unions)
				.where(inArray(unions.treeId, treeIds))
				.orderBy(unions.createdAt, unions.id),
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
				.where(inArray(unions.treeId, treeIds))
				.orderBy(unionChildren.createdAt, unionChildren.childId),
			db
				.select()
				.from(personRelations)
				.where(inArray(personRelations.treeId, treeIds))
				.orderBy(personRelations.createdAt, personRelations.id),
			// contact_details has no treeId either, so it is reached through its people -- in
			// the same round trip, instead of waiting for the people rows to supply their ids.
			db
				.select(getTableColumns(contactDetails))
				.from(contactDetails)
				.innerJoin(people, eq(people.id, contactDetails.personId))
				.where(inArray(people.treeId, treeIds)),
		],
	);

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
	// Who may write is asked alongside who may read: neither answer depends on the other.
	const [{ access, links }, writable] = await Promise.all([
		treeAccessForUser(userId, combined),
		editableTreeIds(userId),
	]);
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

	// Which graph the `+` handles write into (`addRelative`). The viewer's OWN first tree,
	// never a linked one: an accepted person link means "we agree this is the same human",
	// not "you may edit my records". Taken from the write grants rather than assumed from
	// `access`, because that map grants `member` for reading and says nothing about writing.
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
