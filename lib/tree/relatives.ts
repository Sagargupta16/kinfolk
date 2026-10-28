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
type RelationLink = {
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
	 * Anyone sharing a union with the subject as a child, then the children a parent has
	 * through their OTHER unions.
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
	/** Each parent's role claims, one entry per union that records them. */
	const parentClaims = new Map<string, ParentRole[][]>();
	const childClaims = new Map<string, ParentRole[][]>();

	const ownFamilies = index.asChild.get(personId) ?? [];
	for (const union of ownFamilies) {
		for (const parentId of [union.partnerAId, union.partnerBId]) {
			if (parentId) {
				parents.add(parentId);
				push(parentClaims, parentId, parentRoles(union, personId));
			}
		}
		for (const siblingId of union.childIds) {
			// The subject is a child of this union too, and is not their own sibling.
			if (siblingId !== personId) siblings.add(siblingId);
		}
	}

	/*
	 * Half-siblings: the children a parent has through their OTHER unions.
	 *
	 * Walking only the subject's own unions missed them entirely -- a father's children by a
	 * second wife share no union with his first marriage's son -- while `kinshipMap` walks the
	 * parent and calls the same boy "brother", so the panel and the card disagreed about who
	 * the family is. Both ends must be the parent's child as kinship counts one (biological or
	 * adoptive): a stepmother's own son from before shares no parent with the subject, and
	 * neither does anybody the subject is only a stepchild alongside.
	 */
	for (const union of ownFamilies) {
		if (!sharesParent(parentRoles(union, personId))) continue;
		for (const parentId of [union.partnerAId, union.partnerBId]) {
			if (!parentId) continue;
			for (const other of index.asPartner.get(parentId) ?? []) {
				if (other === union) continue;
				for (const childId of other.childIds) {
					if (childId !== personId && sharesParent(parentRoles(other, childId))) {
						siblings.add(childId);
					}
				}
			}
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
			push(childClaims, childId, parentRoles(union, childId));
		}
	}

	return {
		parents: parents.values,
		parentRoles: settleRoles(parentClaims),
		partners: [...partners.values()],
		children: children.values,
		childRoles: settleRoles(childClaims),
		siblings: siblings.values,
		relations: relationsOf(index, personId),
	};
}

/** Roles under which two children of one parent are siblings: those kinship walks as family. */
function sharesParent(roles: readonly ParentRole[]): boolean {
	return roles.includes("biological") || roles.includes("adoptive");
}

/**
 * One parent-child pair's roles, from every union that records the pair.
 *
 * A parent recorded as biological through one union does not ALSO become a step-parent
 * through another. Roles sit on the union, so a father's second marriage recording his son
 * as `step` -- which is what the boy is to the new wife -- reached the father too, and the
 * panel said "father / stepfather". So once any union says biological, claims from unions
 * that do not are dropped. Within ONE union both claims stay: there they are two families
 * disagreeing about the same parent, which fusion preserves on purpose.
 */
function settleRoles(claims: Map<string, ParentRole[][]>): Record<string, ParentRole[]> {
	const settled: Record<string, ParentRole[]> = {};
	for (const [id, perUnion] of claims) {
		const biological = perUnion.filter((roles) => roles.includes("biological"));
		settled[id] = [...new Set((biological.length > 0 ? biological : perUnion).flat())];
	}
	return settled;
}

/**
 * The subject's recorded relations, labelled from THEIR end.
 *
 * `relationLabel()` rather than the edge's own `label`, because the projection wrote
 * that label reading A -> B and half of these edges arrive with the subject at B.
 * Left alone, opening a mentee's panel would list their mentor as "mentor" -- naming
 * the subject's own role instead of the other person's, which inverts the fact. A label the
 * owner typed ("best man") is passed through, as the card's kinship line does, so the
 * panel cannot say "friend" about somebody their card calls the best man.
 */
function relationsOf(index: FamilyIndex, personId: string): RelationLink[] {
	const links: { link: RelationLink; closeness: number }[] = [];

	for (const edge of index.relations) {
		if (edge.source !== personId && edge.target !== personId) continue;
		const otherId = edge.source === personId ? edge.target : edge.source;
		const person = index.people.get(otherId);
		if (!person || !edge.relationKind || !edge.relationId || !edge.relationTreeId) continue;

		links.push({
			link: {
				person,
				relationId: edge.relationId,
				relationTreeId: edge.relationTreeId,
				// `otherId` is the end being NAMED, and `edge.source` is stored A. A symmetric
				// kind reads the same either way, so this only bites on the directed ones.
				label: relationLabel(edge.relationKind, edge.source, otherId, edge.customLabel),
				kind: edge.relationKind,
				ended: Boolean(edge.ended),
			},
			// The edge's own weight, which honours a closeness the owner stored ("a colleague,
			// but my closest one") and drops an ended relation to the floor. The kind's default
			// is only the fallback for an edge that carries none.
			closeness: edge.closeness ?? RELATION_KINDS[edge.relationKind].closeness,
		});
	}

	// Live before ended, then closest first, then alphabetical -- so a panel opens on
	// the connections that still exist rather than on a former colleague.
	return links
		.sort((a, b) => {
			if (a.link.ended !== b.link.ended) return a.link.ended ? 1 : -1;
			if (a.closeness !== b.closeness) return b.closeness - a.closeness;
			return a.link.label.localeCompare(b.link.label);
		})
		.map(({ link }) => link);
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
