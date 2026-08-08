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
import type {
	ContactDetail,
	Person,
	PersonRelation,
	RelationKind,
	Union,
	Verification,
} from "../db/schema";
import { type Closeness, closenessOf, RELATION_KINDS } from "./relations";

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
	/**
	 * The strongest verification any contributing row claims, plus whether the rows
	 * agree. Derived at fusion time rather than stored, because corroboration is a
	 * property of the link graph and goes stale the moment a link is withdrawn.
	 */
	trust: Trust;
};

export type Trust = {
	/** Strongest claim among the sources; `disputed` wins outright when present. */
	level: Verification;
	/** How many distinct families independently assert this person. */
	corroborators: number;
	/**
	 * True when two sources give conflicting vital dates. Surfaced so the card can
	 * say "families disagree" instead of silently rendering whichever row won.
	 */
	conflicted: boolean;
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
			trust: trustOf(members),
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

/**
 * Weakest to strongest. `disputed` is absent on purpose: it is not a rung on this
 * ladder but an override, handled separately in `trustOf`.
 */
const VERIFICATION_RANK: Record<Verification, number> = {
	unverified: 0,
	family_recalled: 1,
	self_confirmed: 2,
	documented: 3,
	disputed: -1,
};

/**
 * How much a fused person is trusted, derived from its contributing rows.
 *
 * Two rules, and the order matters. A single source claiming `disputed` makes the
 * whole person disputed -- a conflict cannot be outvoted by confidence elsewhere.
 * Otherwise the STRONGEST claim wins, because a documented birth certificate in
 * one family is not weakened by another family merely remembering the person.
 *
 * Conflict detection compares only vital dates, not names. Spelling varies
 * legitimately across families ("Katharina" / "Catherine") and flagging that as a
 * disagreement would mark most merged rows as suspect.
 */
export function trustOf(members: Person[]): Trust {
	const corroborators = new Set(members.map((m) => m.treeId)).size;
	const conflicted = hasDateConflict(members);

	if (members.some((m) => m.verification === "disputed") || conflicted) {
		return { level: "disputed", corroborators, conflicted };
	}

	const level = members.reduce<Verification>(
		(best, m) =>
			VERIFICATION_RANK[m.verification] > VERIFICATION_RANK[best] ? m.verification : best,
		"unverified",
	);

	return { level, corroborators, conflicted };
}

/** Two sources giving different birth or death dates for one human. */
function hasDateConflict(members: Person[]): boolean {
	for (const field of ["birthDate", "deathDate"] as const) {
		const values = new Set(members.map((m) => m[field]).filter((v): v is string => Boolean(v)));
		if (values.size > 1) return true;
	}
	return false;
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
 *
 * An unknown partner is NOT a matchable value, which is the subtle half of this.
 * Two children of one father by different unrecorded mothers are half-siblings,
 * and two grandparent couples with no recorded parents are not the same couple.
 * Coercing null to a comparable key merges those into one family and invents
 * sibling relationships nobody recorded -- exactly the half-sibling and
 * single-parent cases the union model exists to get right.
 *
 * But two trees CAN both record the same single-parent family, and that should
 * still collapse to one node. A shared child is what separates the two cases:
 * half-siblings by definition never share one. So a union with an unknown
 * partner merges only into a union with the same known partner AND a child in
 * common.
 */
function dedupeUnions(unions: UnionWithChildren[]): UnionWithChildren[] {
	const byKey = new Map<string, UnionWithChildren>();
	/** Unions with an unknown partner, which cannot be keyed on endpoints alone. */
	const partial: UnionWithChildren[] = [];

	for (const raw of unions) {
		// A bad identity link can fuse both partners into one person. With children,
		// the surviving fact is a single-parent family; without children the row says
		// nothing at all, so drop it rather than drawing a one-ended orphan junction.
		if (raw.partnerAId && raw.partnerAId === raw.partnerBId && raw.childIds.length === 0) {
			continue;
		}
		const union =
			raw.partnerAId && raw.partnerAId === raw.partnerBId ? { ...raw, partnerBId: null } : raw;

		if (!union.partnerAId || !union.partnerBId) {
			partial.push(union);
			continue;
		}

		// Sort endpoints: partner order is not meaningful, so (A,B) and (B,A)
		// describe the same partnership.
		const key = [union.partnerAId, union.partnerBId].sort().join("::");
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, union);
			continue;
		}
		existing.childIds = [...new Set([...existing.childIds, ...union.childIds])];
	}

	const merged: UnionWithChildren[] = [];
	const full = [...byKey.values()];
	for (const union of partial) {
		const knownPartner = union.partnerAId ?? union.partnerBId;
		// A partial can also be a FULL union's echo: one family recorded both
		// parents, the other only one. Same known partner plus a shared child is the
		// same family either way, so the full record absorbs the partial one --
		// otherwise the couple's junction is drawn twice.
		const sameFamily =
			full.find(
				(candidate) =>
					(candidate.partnerAId === knownPartner || candidate.partnerBId === knownPartner) &&
					candidate.childIds.some((id) => union.childIds.includes(id)),
			) ??
			merged.find(
				(candidate) =>
					(candidate.partnerAId ?? candidate.partnerBId) === knownPartner &&
					candidate.childIds.some((id) => union.childIds.includes(id)),
			);

		if (sameFamily) {
			sameFamily.childIds = [...new Set([...sameFamily.childIds, ...union.childIds])];
			continue;
		}
		merged.push({ ...union });
	}

	return [...full, ...merged];
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
	/**
	 * 1..3, how heavily to draw this connection. Only set for relation edges:
	 * family edges are skeleton and all carry the same weight, so varying them
	 * would imply one parentage is firmer than another.
	 */
	closeness?: Closeness;
	/** True once the relation has an end date. Drawn fainter: it is history. */
	ended?: boolean;
};

/**
 * Project a fused graph into nodes and edges.
 *
 * Unions with children get their own node rather than drawing partner-to-child
 * edges directly. With N children that would mean 2N crossing edges; via a union
 * node it is 2 + N, and siblings visibly share one origin point.
 *
 * A CHILDLESS union gets no node, and the couple is joined by ONE edge instead.
 * The dot exists to be the point children descend from, so with nobody descending
 * it costs a node, two edges and a junction to say what a single line between two
 * cards already says. On this graph that was three couples -- Jay and Juhi, and two
 * married sisters -- each rendered as `card -- dot -- card` where `card -- card` is
 * both quieter and more direct.
 *
 * Kinship is unaffected, which is what makes this safe: `indexFamily` in kinship.ts
 * reads `graph.unions` directly, never the projected edges, so a marriage still
 * produces "aunt by marriage" with no dot on screen. The same is true of
 * `relatives.ts`, which lists a person's partners from the union rows.
 */
export function toFlowGraph(graph: FusedGraph): { nodes: FlowNode[]; edges: FlowEdge[] } {
	const nodes: FlowNode[] = graph.people.map((p) => ({ id: p.id, type: "person", data: p }));
	const edges: FlowEdge[] = [];
	const known = new Set(graph.people.map((p) => p.id));

	for (const union of graph.unions) {
		// A couple with no children RECORDED, both partners visible: one edge, no
		// junction.
		//
		// `childIds` rather than the visible subset, and a test pins the difference.
		// Filtering by visibility first meant a couple whose only child sits in a tree
		// the viewer cannot see collapsed to a direct edge -- so the graph's SHAPE
		// depended on who was looking, and the same family drew differently for two
		// people. A projection may hide a node; it must not restructure the family
		// around the viewer.
		const a = union.partnerAId;
		const b = union.partnerBId;
		if (union.childIds.length === 0 && a && b && known.has(a) && known.has(b)) {
			edges.push({
				id: `p:${union.id}:direct`,
				source: a,
				target: b,
				kind: "partner",
				// Still a layout edge: ELK has to keep the pair adjacent, and a couple
				// pulled apart by an unrelated node reads as two strangers.
				layout: true,
			});
			continue;
		}

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

	// Relations are ALWAYS projected, even when the viewer has the overlay off.
	//
	// Hiding them here rather than at render looks equivalent and is not:
	// `anchorFamilylessNodes()` finds a person's row by following who they know, so
	// with the relation edges gone a friend with no family has nothing to anchor to
	// and ELK drops them in the FIRST layer -- rendering them as a generation older
	// than the oldest ancestor. Measured with five such people: y=12 against
	// grandparents at y=124, and a sixth phantom band above the whole tree.
	//
	// So the projection is total and `visibleEdges()` decides what is drawn.
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
			closeness: closenessOf(relation.kind, relation),
			ended: Boolean(relation.endDate),
		});
	}

	return { nodes, edges };
}

/**
 * The edges a viewer with the social overlay off should see.
 *
 * The counterpart to projecting relations unconditionally: ELK needs them to place
 * people, and the viewer asked not to look at them. One helper rather than a
 * `filter` at each call site, because three consumers have to agree on the answer
 * -- what is drawn, which people light up on hover, and how connected each person
 * appears -- and a person whose ring says "well connected" while every line to
 * them is hidden is a worse lie than either fact alone.
 */
export function visibleEdges(edges: FlowEdge[], showRelations: boolean): FlowEdge[] {
	return showRelations ? edges : edges.filter((edge) => edge.kind !== "relation");
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
