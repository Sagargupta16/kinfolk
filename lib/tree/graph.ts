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
import type { Person, Union } from "../db/schema";

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
};

export type FusedGraph = {
	people: FusedPerson[];
	unions: UnionWithChildren[];
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

	for (const [root, members] of groups) {
		for (const member of members) idMap.set(member.id, root);
		people.push({
			id: root,
			primary: pickPrimary(members, primaryTreeId),
			sources: members,
			contributingTreeIds: [...new Set(members.map((m) => m.treeId))],
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

	return { people, unions: dedupeUnions(unions), idMap };
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
	kind: "partner" | "child";
	/** Child edges carry the parentage role so the UI can dash non-biological links. */
	role?: UnionWithChildren["childIds"] extends never ? never : string;
};

/**
 * Project a fused graph into nodes and edges.
 *
 * Unions get their own node rather than drawing partner-to-child edges
 * directly. With N children that would mean 2N crossing edges; via a union node
 * it is 2 + N, and siblings visibly share one origin point.
 */
export function toFlowGraph(graph: FusedGraph): { nodes: FlowNode[]; edges: FlowEdge[] } {
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
