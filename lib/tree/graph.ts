/**
 * Turning stored rows into a renderable graph.
 *
 * Two jobs live here, and they are separate on purpose:
 *
 *   fuseTrees()  -- collapse linked person rows from different trees into one
 *                   logical node, so the combined view shows one grandfather
 *                   rather than two.
 *   toFlowGraph() -- emit React Flow nodes/edges. Unions become their own tiny
 *                   nodes; that is what keeps sibling and partner edges from
 *                   crossing into spaghetti.
 *
 * Layout itself is ELK's problem (see layout.ts). This file stays pure so it is
 * testable without a browser or a database.
 */
import type { ContactDetail, Person, PersonRelation, RelationKind, Union } from "../db/schema";
import { RELATION_KINDS } from "./relations";

/** A union plus its children, as loaded from `unions` + `union_children`. */
export type UnionWithChildren = Union & {
	childIds: string[];
};

/** One tree's slice of data, fetched by the caller. */
export type TreeSlice = {
	treeId: string;
	treeName: string;
	people: Person[];
	unions: UnionWithChildren[];
	/** Non-parentage edges: cousins, friends, colleagues, mentors. */
	relations?: PersonRelation[];
	/** Keyed by person id. Callers pass only details the viewer may see. */
	contacts?: Record<string, ContactDetail[]>;
};

/** An accepted `person_links` row, reduced to the pair. */
export type AcceptedLink = { personAId: string; personBId: string };

/**
 * A logical human: one or more person rows that accepted links say are the
 * same individual. `sources` keeps every contributing row so the UI can show
 * "described by 2 families" and offer a per-field disagreement view.
 */
export type FusedPerson = {
	/** Stable id: the smallest member id, so the value does not depend on input order. */
	id: string;
	primary: Person;
	sources: Person[];
	contributingTreeIds: string[];
	/**
	 * Deduped across every contributing row: two families holding the same phone
	 * number should show it once, not twice.
	 */
	contacts: ContactDetail[];
};

export type FusedGraph = {
	people: FusedPerson[];
	unions: UnionWithChildren[];
	/** Endpoints rewritten onto fused ids, same as unions. */
	relations: PersonRelation[];
	/** Maps every original person id to its fused id. */
	idMap: Map<string, string>;
};

/**
 * Union-find over person ids. Genealogy links are transitive: if A links to B
 * and B links to C, all three are one human, and a naive pairwise merge would
 * miss that.
 */
class DisjointSet {
	private parent = new Map<string, string>();

	find(id: string): string {
		const seen = this.parent.get(id);
		if (seen === undefined) {
			this.parent.set(id, id);
			return id;
		}
		if (seen === id) return id;
		const root = this.find(seen);
		this.parent.set(id, root); // path compression
		return root;
	}

	union(a: string, b: string): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA === rootB) return;
		// Keep the lexicographically smaller root so fused ids are deterministic.
		if (rootA < rootB) this.parent.set(rootB, rootA);
		else this.parent.set(rootA, rootB);
	}
}

/**
 * Merge several trees into one graph using accepted identity links.
 *
 * Only accepted links are passed in: a pending proposal must never alter what
 * anyone sees. Callers filter on status before calling.
 *
 * When several rows describe one human, the row from `primaryTreeId` wins as
 * the display record (it is the viewer's own data). Otherwise the most recently
 * updated row wins, on the assumption that whoever touched it last knew most.
 */
export function fuseTrees(
	slices: TreeSlice[],
	links: AcceptedLink[],
	primaryTreeId?: string,
): FusedGraph {
	const dsu = new DisjointSet();
	const allPeople = slices.flatMap((s) => s.people);

	for (const person of allPeople) dsu.find(person.id);
	for (const link of links) dsu.union(link.personAId, link.personBId);

	const groups = new Map<string, Person[]>();
	for (const person of allPeople) {
		const root = dsu.find(person.id);
		const group = groups.get(root);
		if (group) group.push(person);
		else groups.set(root, [person]);
	}

	const idMap = new Map<string, string>();
	const people: FusedPerson[] = [];

	// Contacts arrive keyed by ORIGINAL person id, so collect them per group.
	const contactsByPersonId = new Map<string, ContactDetail[]>();
	for (const slice of slices) {
		for (const [personId, details] of Object.entries(slice.contacts ?? {})) {
			contactsByPersonId.set(personId, details);
		}
	}

	for (const [root, members] of groups) {
		for (const member of members) idMap.set(member.id, root);
		people.push({
			id: root,
			primary: pickPrimary(members, primaryTreeId),
			sources: members,
			contributingTreeIds: [...new Set(members.map((m) => m.treeId))],
			contacts: dedupeContacts(members.flatMap((m) => contactsByPersonId.get(m.id) ?? [])),
		});
	}

	// Rewrite union endpoints onto fused ids so edges land on the merged nodes.
	const unions = slices
		.flatMap((s) => s.unions)
		.map((u) => ({
			...u,
			partnerAId: u.partnerAId ? (idMap.get(u.partnerAId) ?? u.partnerAId) : null,
			partnerBId: u.partnerBId ? (idMap.get(u.partnerBId) ?? u.partnerBId) : null,
			childIds: [...new Set(u.childIds.map((id) => idMap.get(id) ?? id))],
		}));

	// Same treatment for social/professional edges: after fusion, "my cousin" and
	// "your cousin" pointing at the same human must become one edge.
	const relations = slices
		.flatMap((s) => s.relations ?? [])
		.map((r) => ({
			...r,
			personAId: idMap.get(r.personAId) ?? r.personAId,
			personBId: idMap.get(r.personBId) ?? r.personBId,
		}));

	return {
		people,
		unions: dedupeUnions(unions),
		relations: dedupeRelations(relations),
		idMap,
	};
}

/**
 * Same channel + same value is the same contact, regardless of which family
 * recorded it. Kept in first-seen order, and a primary flag from any source
 * wins so a merged card still knows which number to show first.
 */
function dedupeContacts(details: ContactDetail[]): ContactDetail[] {
	const byKey = new Map<string, ContactDetail>();

	for (const detail of details) {
		const key = `${detail.kind}::${detail.value.trim().toLowerCase()}`;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, detail);
			continue;
		}
		if (detail.isPrimary && !existing.isPrimary) byKey.set(key, detail);
	}

	return [...byKey.values()];
}

/**
 * After fusion two trees can describe the same friendship or cousinhood. Keyed
 * on kind plus endpoints, with symmetric kinds sorted so (A,B) and (B,A) collapse
 * while directed kinds stay distinct -- "A mentors B" and "B mentors A" are two
 * different claims and both deserve to survive.
 */
function dedupeRelations(relations: PersonRelation[]): PersonRelation[] {
	const byKey = new Map<string, PersonRelation>();

	for (const relation of relations) {
		if (relation.personAId === relation.personBId) continue; // fusion made it a self-loop
		const pair = RELATION_KINDS[relation.kind].symmetric
			? [relation.personAId, relation.personBId].sort().join("::")
			: `${relation.personAId}->${relation.personBId}`;
		const key = `${relation.kind}::${pair}`;
		if (!byKey.has(key)) byKey.set(key, relation);
	}

	return [...byKey.values()];
}

function pickPrimary(members: Person[], primaryTreeId?: string): Person {
	if (primaryTreeId) {
		const mine = members.find((m) => m.treeId === primaryTreeId);
		if (mine) return mine;
	}
	return members.reduce((best, current) => (current.updatedAt > best.updatedAt ? current : best));
}

/**
 * After fusion, two trees that both recorded the same marriage produce two
 * union rows with identical endpoints. Collapse them, keeping the union of
 * their children so neither family's records are dropped.
 */
function dedupeUnions(unions: UnionWithChildren[]): UnionWithChildren[] {
	const byKey = new Map<string, UnionWithChildren>();

	for (const union of unions) {
		// Sort endpoints: partner order is not meaningful, so (A,B) and (B,A)
		// describe the same partnership.
		const key = [union.partnerAId ?? "", union.partnerBId ?? ""].sort().join("::");
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, union);
			continue;
		}
		existing.childIds = [...new Set([...existing.childIds, ...union.childIds])];
	}

	return [...byKey.values()];
}

/* -------------------------------------------------------------------------- */
/* React Flow projection                                                      */
/* -------------------------------------------------------------------------- */

export type FlowNode =
	| { id: string; type: "person"; data: FusedPerson }
	| { id: string; type: "union"; data: { union: UnionWithChildren } };

export type FlowEdge = {
	id: string;
	source: string;
	target: string;
	kind: "partner" | "child" | "relation";
	/**
	 * False for edges that must not influence node placement.
	 *
	 * This is the whole reason social edges are worth separating: a friendship is
	 * not hierarchical, and handing it to a layered layout drags that friend into
	 * a lower generation. Layout runs on family edges; the rest is overlay.
	 */
	layout: boolean;
	/** Relation kind, for styling and the edge label. Only set when kind is "relation". */
	relationKind?: RelationKind;
	/** Pre-rendered label ("cousin", "mentor"), read A -> B. */
	label?: string;
	/** Symmetric relations draw no arrowhead. */
	directed?: boolean;
};

/**
 * Project a fused graph into nodes and edges.
 *
 * Unions get their own node rather than drawing partner-to-child edges
 * directly. With N children that would mean 2N crossing edges; via a union node
 * it is 2 + N, and siblings visibly share one origin point.
 */
export function toFlowGraph(
	graph: FusedGraph,
	options: { includeRelations?: boolean } = {},
): { nodes: FlowNode[]; edges: FlowEdge[] } {
	const nodes: FlowNode[] = graph.people.map((p) => ({ id: p.id, type: "person", data: p }));
	const edges: FlowEdge[] = [];
	const known = new Set(graph.people.map((p) => p.id));

	for (const union of graph.unions) {
		const unionNodeId = `union:${union.id}`;
		nodes.push({ id: unionNodeId, type: "union", data: { union } });

		for (const partnerId of [union.partnerAId, union.partnerBId]) {
			// Guard against dangling references: a partner may sit in a tree the
			// viewer cannot see, in which case the union renders one-sided.
			if (partnerId && known.has(partnerId)) {
				edges.push({
					id: `p:${partnerId}:${union.id}`,
					source: partnerId,
					target: unionNodeId,
					kind: "partner",
					layout: true,
				});
			}
		}

		for (const childId of union.childIds) {
			if (!known.has(childId)) continue;
			edges.push({
				id: `c:${union.id}:${childId}`,
				source: unionNodeId,
				target: childId,
				kind: "child",
				layout: true,
			});
		}
	}

	if (options.includeRelations !== false) {
		for (const relation of graph.relations) {
			// Both ends must be visible; a relation to someone in a tree the viewer
			// cannot see is simply not drawn.
			if (!known.has(relation.personAId) || !known.has(relation.personBId)) continue;

			const spec = RELATION_KINDS[relation.kind];
			edges.push({
				id: `r:${relation.id}`,
				source: relation.personAId,
				target: relation.personBId,
				kind: "relation",
				// Never influences placement. See the FlowEdge comment.
				layout: false,
				relationKind: relation.kind,
				label: relation.label ?? spec.label,
				directed: !spec.symmetric,
			});
		}
	}

	return { nodes, edges };
}

/** Display name with sensible fallbacks; genealogy data is often partial. */
export function displayName(person: Person): string {
	const parts = [person.givenName, person.familyName].filter(Boolean);
	if (parts.length > 0) return parts.join(" ");
	if (person.nickname) return person.nickname;
	return "Unknown";
}

/** "1890 - 1954", "b. 1890", "" -- whatever the data supports. */
export function lifespan(person: Person): string {
	const birth = year(person.birthDate) ?? person.birthDateApprox;
	const death = year(person.deathDate) ?? person.deathDateApprox;
	if (birth && death) return `${birth} - ${death}`;
	if (birth) return `b. ${birth}`;
	if (death) return `d. ${death}`;
	return "";
}

function year(value: string | null): string | null {
	return value ? value.slice(0, 4) : null;
}
