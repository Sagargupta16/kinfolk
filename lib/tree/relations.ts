/**
 * What every relation kind MEANS. Single source of truth, used by three callers
 * that must agree or the data rots:
 *
 *   - insert, to canonicalise the pair before writing
 *   - display, to read an edge from either end
 *   - the canvas, to decide arrowhead and styling
 *
 * The key decision: directed kinds are stored ONE way only. "B is A's mentee"
 * is not a row -- it is the row "A mentor B" read from B's side. Storing both
 * directions as separate enum values would let the same fact exist twice with
 * nothing to reconcile them.
 */
import type { RelationKind } from "../db/schema";

export type RelationCategory = "kin" | "social" | "professional" | "care" | "other";

/**
 * How close a relation is, 1 (acquaintance) to 3 (intimate).
 *
 * Drives how heavily the edge is drawn, so a close friendship reads as a firmer
 * connection than a former colleague. Deliberately coarse: three steps is all
 * that survives being rendered as stroke weight, and a finer scale would invite
 * arguments about whether a neighbour outranks a classmate.
 */
export type Closeness = 1 | 2 | 3;

type RelationSpec = {
	/** Reading A -> B: "A is B's ___". */
	label: string;
	/** Reading B -> A. Equals `label` when symmetric. */
	inverse: string;
	/** Symmetric relations have no direction, so no arrowhead and a sorted pair. */
	symmetric: boolean;
	category: RelationCategory;
	/** Default weight for the edge. A stored `closeness` on the row overrides it. */
	closeness: Closeness;
};

export const RELATION_KINDS: Record<RelationKind, RelationSpec> = {
	/* Kin the union model cannot express on its own. `cousin` and `in_law` exist
	   for the common case where you know you are related but not through whom --
	   asserting the edge beats inventing ancestors you have no record of. */
	cousin: { label: "cousin", inverse: "cousin", symmetric: true, category: "kin", closeness: 2 },
	in_law: { label: "in-law", inverse: "in-law", symmetric: true, category: "kin", closeness: 2 },
	step_sibling: {
		label: "step-sibling",
		inverse: "step-sibling",
		symmetric: true,
		category: "kin",
		closeness: 3,
	},
	godparent: {
		label: "godparent",
		inverse: "godchild",
		symmetric: false,
		category: "kin",
		closeness: 3,
	},

	friend: {
		label: "friend",
		inverse: "friend",
		symmetric: true,
		category: "social",
		closeness: 2,
	},
	close_friend: {
		label: "close friend",
		inverse: "close friend",
		symmetric: true,
		category: "social",
		closeness: 3,
	},
	family_friend: {
		label: "family friend",
		inverse: "family friend",
		symmetric: true,
		category: "social",
		closeness: 2,
	},
	neighbour: {
		label: "neighbour",
		inverse: "neighbour",
		symmetric: true,
		category: "social",
		closeness: 1,
	},
	classmate: {
		label: "classmate",
		inverse: "classmate",
		symmetric: true,
		category: "social",
		closeness: 1,
	},
	roommate: {
		label: "roommate",
		inverse: "roommate",
		symmetric: true,
		category: "social",
		closeness: 2,
	},

	colleague: {
		label: "colleague",
		inverse: "colleague",
		symmetric: true,
		category: "professional",
		closeness: 1,
	},
	business_partner: {
		label: "business partner",
		inverse: "business partner",
		symmetric: true,
		category: "professional",
		closeness: 2,
	},
	mentor: {
		label: "mentor",
		inverse: "mentee",
		symmetric: false,
		category: "professional",
		closeness: 2,
	},
	teacher: {
		label: "teacher",
		inverse: "student",
		symmetric: false,
		category: "professional",
		closeness: 1,
	},
	employer: {
		label: "employer",
		inverse: "employee",
		symmetric: false,
		category: "professional",
		closeness: 1,
	},

	caregiver: {
		label: "caregiver",
		inverse: "cared for by",
		symmetric: false,
		category: "care",
		closeness: 3,
	},

	other: {
		label: "connected to",
		inverse: "connected to",
		symmetric: true,
		category: "other",
		closeness: 1,
	},
};

/**
 * Storage order for a pair. Symmetric kinds get sorted ids so (A,B) and (B,A)
 * cannot both exist; directed kinds keep the caller's order, because there A is
 * the mentor/teacher/godparent and B is not.
 */
export function canonicalPair(
	kind: RelationKind,
	personAId: string,
	personBId: string,
): { personAId: string; personBId: string } {
	if (!RELATION_KINDS[kind].symmetric) return { personAId, personBId };
	return personAId <= personBId
		? { personAId, personBId }
		: { personAId: personBId, personBId: personAId };
}

/** How this relation reads when viewed from `fromPersonId`. */
export function relationLabel(
	kind: RelationKind,
	personAId: string,
	fromPersonId: string,
	customLabel?: string | null,
): string {
	if (customLabel) return customLabel;
	const spec = RELATION_KINDS[kind];
	return fromPersonId === personAId ? spec.label : spec.inverse;
}

/**
 * Weight for one relation edge.
 *
 * An ENDED relation always drops to the floor whatever its kind says, because a
 * former business partner is a historical fact rather than a live connection,
 * and drawing it as heavily as a current one overstates the graph.
 */
export function closenessOf(
	kind: RelationKind,
	row: { closeness?: number | null; endDate?: string | null } = {},
): Closeness {
	if (row.endDate) return 1;
	const stored = row.closeness;
	if (stored === 1 || stored === 2 || stored === 3) return stored;
	return RELATION_KINDS[kind].closeness;
}

/** Grouped for pickers, so the editor does not show 17 flat options. */
export function kindsByCategory(): Record<RelationCategory, RelationKind[]> {
	const grouped: Record<RelationCategory, RelationKind[]> = {
		kin: [],
		social: [],
		professional: [],
		care: [],
		other: [],
	};
	for (const [kind, spec] of Object.entries(RELATION_KINDS)) {
		grouped[spec.category].push(kind as RelationKind);
	}
	return grouped;
}
