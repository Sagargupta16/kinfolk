/**
 * One person's immediate family, read back out of the projected graph.
 *
 * The detail panel asks a question no existing helper answers. `kinship.ts` says
 * what somebody is to the VIEWER, which is a different question from what they are
 * to the person whose panel is open -- open your grandmother's card and the panel
 * has to list HER children, not yours. And `neighbourhood.ts` answers "who lights
 * up", returning ids with no roles attached, because a highlight does not care
 * whether an edge went up or down.
 *
 * Derived from `FlowNode[]` rather than from the database, and that is deliberate:
 * the client already holds every union row on its union nodes, so a fetch would
 * send a second copy of data in memory and could disagree with what is drawn. It
 * also means the panel works identically in demo mode, where there is no database
 * to ask.
 *
 * Pure -- no React, no DB -- so the role assignments are unit-testable. A panel
 * that lists a stepson as a brother is the kind of error a reader believes.
 */
import type { ParentRole } from "../db/schema";
import type { FlowEdge, FlowNode, FusedPerson, UnionWithChildren } from "./graph";
import { unionsInGraph } from "./graph";
import { parentRoles } from "./parentage";
import { RELATION_KINDS, relationLabel } from "./relations";

/**
 * A partner plus the union that joins them.
 *
 * The union travels with the person because "wife" and "ex-wife" are the same row
 * distinguished only by `status`, and a panel that dropped it would have to render
 * a divorce as a marriage.
 */
export type Partnership = {
	person: FusedPerson;
	union: UnionWithChildren;
};

/** A non-hierarchical connection, already read from the subject's end. */
export type RelationLink = {
	person: FusedPerson;
	relationId: string;
	relationTreeId: string;
	/** "mentor" or "mentee" depending on which end the subject sits at. */
	label: string;
	kind: FlowEdge["relationKind"];
	ended: boolean;
};

export type Relatives = {
	/** Everyone recorded as a parent, through any union. */
	parents: FusedPerson[];
	parentRoles: Record<string, ParentRole[]>;
	partners: Partnership[];
	children: FusedPerson[];
	childRoles: Record<string, ParentRole[]>;
	/**
	 * Anyone sharing a union with the subject as a child.
	 *
	 * Half-siblings included and NOT distinguished, because the union model already
	 * makes the distinction visible on the canvas and a panel that labelled somebody
	 * "half-brother" would assert a degree of relatedness nobody typed. What matters
	 * here is that the subject is excluded from their own sibling list, which a naive
	 * "every child of my parents' unions" pass gets wrong.
	 */
	siblings: FusedPerson[];
	relations: RelationLink[];
};

/**
 * Index the graph once, then answer for any person.
 *
 * A per-person pass over every union is O(people * unions), and the panel is
 * rebuilt whenever the selected person changes -- which on this canvas is every
 * click. Building the index once per graph turns that into a lookup.
 */
export type FamilyIndex = {
	people: Map<string, FusedPerson>;
	unions: UnionWithChildren[];
	/** Person id to the unions they are a partner in. */
	asPartner: Map<string, UnionWithChildren[]>;
	/** Person id to the unions they are a child of. */
	asChild: Map<string, UnionWithChildren[]>;
	relations: FlowEdge[];
};

export function indexRelatives(nodes: FlowNode[], edges: FlowEdge[]): FamilyIndex {
	const people = new Map<string, FusedPerson>();
	const unions = unionsInGraph(nodes, edges);
	const asPartner = new Map<string, UnionWithChildren[]>();
	const asChild = new Map<string, UnionWithChildren[]>();

	for (const node of nodes) {
		if (node.type === "person") people.set(node.id, node.data);
	}

	for (const union of unions) {
		for (const partnerId of [union.partnerAId, union.partnerBId]) {
			if (partnerId) push(asPartner, partnerId, union);
		}
		for (const childId of union.childIds) push(asChild, childId, union);
	}

	return {
		people,
		unions,
		asPartner,
		asChild,
		relations: edges.filter((edge) => edge.kind === "relation"),
	};
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
	const existing = map.get(key);
	if (existing) existing.push(value);
	else map.set(key, [value]);
}

/**
 * Who this person's family is, in the roles a panel needs to name them.
 *
 * Every list is deduplicated by id. That is not defensive tidying: a child can
 * belong to two unions (birth and adoptive), so walking "my unions, their children"
 * legitimately reaches the same sibling twice, and a panel listing a sister twice
 * looks broken in a way that undermines everything else on it.
 */
export function relativesOf(index: FamilyIndex, personId: string): Relatives {
	const parents = new Dedupe(index);
	const children = new Dedupe(index);
	const siblings = new Dedupe(index);
	const partners = new Map<string, Partnership>();
	const rolesByParent: Record<string, ParentRole[]> = {};
	const rolesByChild: Record<string, ParentRole[]> = {};

	for (const union of index.asChild.get(personId) ?? []) {
		for (const parentId of [union.partnerAId, union.partnerBId]) {
			if (parentId) {
				parents.add(parentId);
				rolesByParent[parentId] = [
					...new Set([...(rolesByParent[parentId] ?? []), ...parentRoles(union, personId)]),
				];
			}
		}
		for (const siblingId of union.childIds) {
			// The subject is a child of this union too, and is not their own sibling.
			if (siblingId !== personId) siblings.add(siblingId);
		}
	}

	for (const union of index.asPartner.get(personId) ?? []) {
		for (const partnerId of [union.partnerAId, union.partnerBId]) {
			if (!partnerId || partnerId === personId) continue;
			const person = index.people.get(partnerId);
			// Keyed on the person, not the union: a couple who married, divorced and
			// remarried has two union rows and is still one partner. First wins, which is
			// the order `unions` arrived in.
			if (person && !partners.has(partnerId)) partners.set(partnerId, { person, union });
		}
		for (const childId of union.childIds) {
			children.add(childId);
			rolesByChild[childId] = [
				...new Set([...(rolesByChild[childId] ?? []), ...parentRoles(union, childId)]),
			];
		}
	}

	return {
		parents: parents.values,
		parentRoles: rolesByParent,
		partners: [...partners.values()],
		children: children.values,
		childRoles: rolesByChild,
		siblings: siblings.values,
		relations: relationsOf(index, personId),
	};
}

/**
 * The subject's recorded relations, labelled from THEIR end.
 *
 * `relationLabel()` rather than the edge's own `label`, because the projection wrote
 * that label reading A -> B and half of these edges arrive with the subject at B.
 * Left alone, opening a mentee's panel would list their mentor as "mentor" -- naming
 * the subject's own role instead of the other person's, which inverts the fact.
 */
function relationsOf(index: FamilyIndex, personId: string): RelationLink[] {
	const links: RelationLink[] = [];

	for (const edge of index.relations) {
		if (edge.source !== personId && edge.target !== personId) continue;
		const otherId = edge.source === personId ? edge.target : edge.source;
		const person = index.people.get(otherId);
		if (!person || !edge.relationKind || !edge.relationId || !edge.relationTreeId) continue;

		links.push({
			person,
			relationId: edge.relationId,
			relationTreeId: edge.relationTreeId,
			// `otherId` is the end being NAMED, and `edge.source` is stored A. A symmetric
			// kind reads the same either way, so this only bites on the directed ones.
			label: relationLabel(edge.relationKind, edge.source, otherId),
			kind: edge.relationKind,
			ended: Boolean(edge.ended),
		});
	}

	// Live before ended, then closest first, then alphabetical -- so a panel opens on
	// the connections that still exist rather than on a former colleague.
	return links.sort((a, b) => {
		if (a.ended !== b.ended) return a.ended ? 1 : -1;
		const closeness =
			(RELATION_KINDS[b.kind ?? "other"]?.closeness ?? 0) -
			(RELATION_KINDS[a.kind ?? "other"]?.closeness ?? 0);
		if (closeness !== 0) return closeness;
		return a.label.localeCompare(b.label);
	});
}

/** An insertion-ordered set of people, resolved through the index. */
class Dedupe {
	private readonly seen = new Set<string>();
	private readonly people: FusedPerson[] = [];

	constructor(private readonly index: FamilyIndex) {}

	add(id: string): void {
		if (this.seen.has(id)) return;
		const person = this.index.people.get(id);
		// Silently skipped rather than pushed as a placeholder: a partner can sit in a
		// tree the viewer cannot see, and the union then renders one-sided on the canvas
		// too. Inventing an "Unknown" row here would contradict the picture.
		if (!person) return;
		this.seen.add(id);
		this.people.push(person);
	}

	get values(): FusedPerson[] {
		return this.people;
	}
}
