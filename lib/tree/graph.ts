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
	ParentRole,
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
	/** Preserve each family's parentage claims when records are fused. Absent in legacy views. */
	childRoles?: Record<string, ParentRole[]>;
};

/** One tree's slice of data, fetched by the caller. */
export type TreeSlice = {
	treeId: string;
	treeName: string;
	people: Person[];
	unions: UnionWithChildren[];
	/** Non-parentage edges: cousins, friends, colleagues, mentors. */
	relations?: PersonRelation[];
	/**
	 * Keyed by person id. Callers pass only details the viewer may see. Full rows, values
	 * included, because fusion compares values to merge two families' copies of one number;
	 * the fused graph keeps only the channel (see `ContactChannel`).
	 */
	contacts?: Record<string, ContactDetail[]>;
};

/**
 * A contact as the canvas holds it: which channel exists, never what it says.
 *
 * The value is dropped at fusion, before anything is projected, because everything past
 * this file reaches a browser -- as client-component props on the server-rendered page and
 * as the `/api/tree` JSON for the SPA -- and the canvas only ever draws the channel. A value
 * is read on the contact page, which loads it after a deliberate visit and checks access on
 * that read. Carrying values here sent every visible phone number to every page load.
 */
export type ContactChannel = Omit<ContactDetail, "value">;

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
	 * number should show it once, not twice. Channels only, never values.
	 */
	contacts: ContactChannel[];
	/**
	 * The strongest verification any contributing row claims, plus whether the rows
	 * agree. Derived at fusion time rather than stored, because corroboration is a
	 * property of the link graph and goes stale the moment a link is withdrawn.
	 */
	trust: Trust;
};

type Trust = {
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
		.map((u) => {
			const childRoles: Record<string, ParentRole[]> = {};
			for (const id of u.childIds) {
				const fusedId = idMap.get(id) ?? id;
				childRoles[fusedId] = [
					...new Set([...(childRoles[fusedId] ?? []), ...(u.childRoles?.[id] ?? ["biological"])]),
				];
			}
			return {
				...u,
				partnerAId: u.partnerAId ? (idMap.get(u.partnerAId) ?? u.partnerAId) : null,
				partnerBId: u.partnerBId ? (idMap.get(u.partnerBId) ?? u.partnerBId) : null,
				childIds: [...new Set(u.childIds.map((id) => idMap.get(id) ?? id))],
				childRoles,
			};
		});

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
 *
 * The value is compared here and then dropped: this is the last point that may read it.
 */
function dedupeContacts(details: ContactDetail[]): ContactChannel[] {
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

	return [...byKey.values()].map(({ value: _value, ...channel }) => channel);
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
function trustOf(members: Person[]): Trust {
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
 *
 * That rule is applied TRANSITIVELY, by union-find over the shared children. Applied
 * pairwise in arrival order it was first-match: three records of one father with children
 * [a], [a, b] and [b, c] became one family when the middle record arrived second, and two
 * families sharing child b when it arrived last -- so the shape of somebody's family
 * depended on the order the trees were loaded in. A merged single-parent family keeps the
 * smallest union id, for the reason a fused person keeps the smallest member id.
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
		const key = pairKey(union);
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, union);
			continue;
		}
		mergeChildren(existing, union);
		settleStanding(existing, union);
	}
	const full = [...byKey.values()];

	// Partial records of one family: the same known partner (or none, for a bare sibling
	// junction) and a child in common, followed transitively.
	const families = new DisjointSet();
	const holder = new Map<string, string>();
	for (const union of partial) {
		families.find(union.id);
		const partner = union.partnerAId ?? union.partnerBId ?? "";
		for (const childId of union.childIds) {
			const key = `${partner}::${childId}`;
			const first = holder.get(key);
			if (first) families.union(first, union.id);
			else holder.set(key, union.id);
		}
	}
	const groups = new Map<string, UnionWithChildren[]>();
	for (const union of partial) {
		const root = families.find(union.id);
		const group = groups.get(root);
		if (group) group.push(union);
		else groups.set(root, [union]);
	}

	// Each full union's own children, read before any partial is absorbed, so which couple
	// absorbs a family never depends on which family was absorbed first.
	const recorded = new Map(full.map((union) => [union, new Set(union.childIds)]));
	const fullByPartner = new Map<string, UnionWithChildren[]>();
	for (const union of full) {
		for (const partnerId of [union.partnerAId, union.partnerBId]) {
			if (!partnerId) continue;
			const existing = fullByPartner.get(partnerId);
			if (existing) existing.push(union);
			else fullByPartner.set(partnerId, [union]);
		}
	}

	const merged: UnionWithChildren[] = [];
	for (const members of groups.values()) {
		// Smallest id first: the same order the union-find chose its root by.
		const records = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		const children = new Set(records.flatMap((union) => union.childIds));
		const knownPartner = records[0]?.partnerAId ?? records[0]?.partnerBId;

		// A partial can also be a FULL union's echo: one family recorded both
		// parents, the other only one. Same known partner plus a shared child is the
		// same family either way, so the full record absorbs the partial ones --
		// otherwise the couple's junction is drawn twice. Should two couples qualify, the
		// one sharing more children wins, then the lower pair of ids.
		let echo: UnionWithChildren | undefined;
		let shared = 0;
		for (const candidate of knownPartner ? (fullByPartner.get(knownPartner) ?? []) : []) {
			let count = 0;
			for (const childId of recorded.get(candidate) ?? []) if (children.has(childId)) count += 1;
			if (count === 0) continue;
			if (count > shared || (count === shared && echo && pairKey(candidate) < pairKey(echo))) {
				echo = candidate;
				shared = count;
			}
		}
		if (echo) {
			for (const union of records) mergeChildren(echo, union);
			continue;
		}

		const [first, ...rest] = records;
		if (!first) continue;
		const family = { ...first };
		for (const union of rest) mergeChildren(family, union);
		merged.push(family);
	}

	return [...full, ...merged];
}

/** The id-sorted pair of a full union, so (A, B) and (B, A) are one couple. */
function pairKey(union: UnionWithChildren): string {
	return [union.partnerAId, union.partnerBId].sort().join("::");
}

/**
 * How much a union status says, for settling two records of one couple.
 *
 * `unknown` says nothing, so any recorded status outranks it. A partnership that has not
 * ended outranks one that has: two rows for one couple in one tree is a couple who split up
 * and found each other again, and the later partnership is the one that describes them now.
 * A marriage outranks an unmarried partnership for the same reason. Ranked rather than
 * first-wins, so the merged status does not depend on the order the trees arrived in.
 */
const STATUS_WEIGHT: Record<UnionWithChildren["status"], number> = {
	unknown: 0,
	separated: 1,
	divorced: 1,
	partnered: 2,
	married: 3,
	widowed: 3,
};

/**
 * Take the partnership's standing -- status and the dates and place that go with it -- from
 * whichever record says more. Only between two records of the SAME couple: a single-parent
 * record says nothing about a couple's standing, so absorbing one never changes it.
 */
function settleStanding(target: UnionWithChildren, source: UnionWithChildren): void {
	if (STATUS_WEIGHT[source.status] <= STATUS_WEIGHT[target.status]) return;
	target.status = source.status;
	target.startDate = source.startDate;
	target.endDate = source.endDate;
	target.place = source.place;
}

function mergeChildren(target: UnionWithChildren, source: UnionWithChildren): void {
	const roles = { ...target.childRoles };
	for (const id of source.childIds) {
		roles[id] = [
			...new Set([...(roles[id] ?? []), ...(source.childRoles?.[id] ?? ["biological"])]),
		];
	}
	target.childIds = [...new Set([...target.childIds, ...source.childIds])];
	target.childRoles = roles;
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
	/** A childless partnership has no junction node, so its record travels on the edge. */
	union?: UnionWithChildren;
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
	/** The stored relation row, used for precise connection removal. */
	relationId?: string;
	/** The tree that owns the relation, used to show removal only to its editors. */
	relationTreeId?: string;
	/** Pre-rendered label ("cousin", "mentor"), read A -> B. */
	label?: string;
	/**
	 * The relation row's own label, when its owner typed one ("best man"). Kept apart from
	 * `label` so a reader at either end can tell a typed label, which reads the same from
	 * both, from the kind's default, which has to be turned round for the B end.
	 */
	customLabel?: string;
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

/** All partnership records, independent of whether they render as a node or an edge. */
export function unionsInGraph(
	nodes: readonly FlowNode[],
	edges: readonly FlowEdge[],
): UnionWithChildren[] {
	const unions = new Map<string, UnionWithChildren>();
	for (const node of nodes) {
		if (node.type === "union") unions.set(node.data.union.id, node.data.union);
	}
	for (const edge of edges) {
		if (edge.union) unions.set(edge.union.id, edge.union);
	}
	return [...unions.values()];
}

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
		// `childIds` rather than the visible subset, and the difference was once pinned by
		// a test in the suite removed in 0.2.0. Filtering by visibility first meant a couple
		// whose only child sits in a tree
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
				union,
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
			relationId: relation.id,
			relationTreeId: relation.treeId,
			label: relation.label ?? spec.label,
			...(relation.label ? { customLabel: relation.label } : {}),
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
export function displayName(person: Pick<Person, "givenName" | "familyName" | "nickname">): string {
	const parts = [person.givenName, person.familyName].filter(Boolean);
	if (parts.length > 0) return parts.join(" ");
	if (person.nickname) return person.nickname;
	return "Unknown";
}

/** "1890 - 1954", "b. 1890", "" -- whatever the data supports. */
export function lifespan(person: Person): string {
	const birth = birthYear(person);
	const death = deathYear(person);
	if (birth && death) return `${birth} - ${death}`;
	if (birth) return `b. ${birth}`;
	if (death) return `d. ${death}`;
	return "";
}

/**
 * The year a person was born, as every surface writes it: the exact date's year, else the
 * approximate text as recorded ("about 1890"), else null.
 *
 * One rule for the card, the panel and the layout's sibling order, which each kept their own
 * copy. The approximate text is returned whole because "about" is the information --
 * flattening it to 1890 would assert a precision nobody recorded. A caller that needs a
 * number (sorting, the generation rails) takes the first four-digit run of this.
 */
export function birthYear(person: Pick<Person, "birthDate" | "birthDateApprox">): string | null {
	return dateYear(person.birthDate) ?? person.birthDateApprox;
}

/** The year a person died, by the same rule as `birthYear`. */
export function deathYear(person: Pick<Person, "deathDate" | "deathDateApprox">): string | null {
	return dateYear(person.deathDate) ?? person.deathDateApprox;
}

function dateYear(value: string | null): string | null {
	return value ? value.slice(0, 4) : null;
}
