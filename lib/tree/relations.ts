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

type RelationSpec = {
	/** Reading A -> B: "A is B's ___". */
	label: string;
	/** Reading B -> A. Equals `label` when symmetric. */
	inverse: string;
	/** Symmetric relations have no direction, so no arrowhead and a sorted pair. */
	symmetric: boolean;
	category: RelationCategory;
};

export const RELATION_KINDS: Record<RelationKind, RelationSpec> = {
	/* Kin the union model cannot express on its own. `cousin` and `in_law` exist
	   for the common case where you know you are related but not through whom --
	   asserting the edge beats inventing ancestors you have no record of. */
	cousin: { label: "cousin", inverse: "cousin", symmetric: true, category: "kin" },
	in_law: { label: "in-law", inverse: "in-law", symmetric: true, category: "kin" },
	step_sibling: {
		label: "step-sibling",
		inverse: "step-sibling",
		symmetric: true,
		category: "kin",
	},
	godparent: { label: "godparent", inverse: "godchild", symmetric: false, category: "kin" },

	friend: { label: "friend", inverse: "friend", symmetric: true, category: "social" },
	close_friend: {
		label: "close friend",
		inverse: "close friend",
		symmetric: true,
		category: "social",
	},
	family_friend: {
		label: "family friend",
		inverse: "family friend",
		symmetric: true,
		category: "social",
	},
	neighbour: { label: "neighbour", inverse: "neighbour", symmetric: true, category: "social" },
	classmate: { label: "classmate", inverse: "classmate", symmetric: true, category: "social" },
	roommate: { label: "roommate", inverse: "roommate", symmetric: true, category: "social" },

	colleague: {
		label: "colleague",
		inverse: "colleague",
		symmetric: true,
		category: "professional",
	},
	business_partner: {
		label: "business partner",
		inverse: "business partner",
		symmetric: true,
		category: "professional",
	},
	mentor: { label: "mentor", inverse: "mentee", symmetric: false, category: "professional" },
	teacher: { label: "teacher", inverse: "student", symmetric: false, category: "professional" },
	employer: { label: "employer", inverse: "employee", symmetric: false, category: "professional" },

	caregiver: { label: "caregiver", inverse: "cared for by", symmetric: false, category: "care" },

	other: { label: "connected to", inverse: "connected to", symmetric: true, category: "other" },
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
