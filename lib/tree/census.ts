/**
 * What this particular tree actually contains.
 *
 * Written for the legend, and the reason it exists rather than the legend hardcoding
 * the app's vocabulary: Kinfolk knows 17 relation kinds in 5 categories and 5
 * verification levels, but no real tree uses all of them. A key that lists an
 * encoding nobody can find sends a reader hunting the canvas for a line that is not
 * there, and after one such row the rest of the key stops being trusted.
 *
 * So every count here answers "is this mark on screen, and how often", and the legend
 * drops any row whose count is zero. The counts double as the answer to a question the
 * stats header cannot fit -- how much of this graph is friendship versus parentage.
 *
 * Counted from the DRAWN edges, which the caller filters. With the social overlay off
 * every relation count is zero and the whole overlay section disappears, which is
 * correct: those lines genuinely are not being drawn.
 *
 * Pure, like everything in lib/tree: no React, no DB.
 */
import type { RelationKind, Verification } from "../db/schema";
import { type Degree, RING_MIN_RANK } from "./density";
import type { FlowEdge, FlowNode } from "./graph";
import { RELATION_KINDS, type RelationCategory } from "./relations";

export type TreeCensus = {
	/** Parent-child and partner-to-union edges. The skeleton. */
	family: number;
	partners: number;
	/** Relation edges per category, zero for a category this tree does not use. */
	categories: Record<RelationCategory, number>;
	/** Which kinds occur, per category, so the hint lists only findable ones. */
	kinds: Record<RelationCategory, RelationKind[]>;
	/** Relation edges with an end date, drawn in the past colour. */
	ended: number;
	/** How many distinct closeness weights occur. One weight is not a scale. */
	closenessLevels: number;
	/** People by living status, which drives the rail and the dot fill. */
	living: number;
	deceased: number;
	livingUnknown: number;
	/** People per verification level, so a mark with nobody behind it is not listed. */
	provenance: Record<Verification, number>;
	/** People whose families disagree about a date. */
	conflicted: number;
	/** People described by more than one family, which draws the offset sheets. */
	merged: number;
	/** People with a channel on file, in either of the two icon groups. */
	withPhone: number;
	withHandle: number;
	/** People whose rank clears the ring floor, so a ring is actually visible. */
	ringed: number;
};

function emptyByCategory<T>(make: () => T): Record<RelationCategory, T> {
	return { kin: make(), social: make(), professional: make(), care: make(), other: make() };
}

export function censusOf(
	nodes: FlowNode[],
	/** The edges being DRAWN, not every projected edge. See the module comment. */
	edges: FlowEdge[],
	degree?: Map<string, Degree>,
): TreeCensus {
	const categories = emptyByCategory(() => 0);
	const kindSets = emptyByCategory(() => new Set<RelationKind>());
	const weights = new Set<number>();
	let family = 0;
	let partners = 0;
	let ended = 0;

	for (const edge of edges) {
		if (edge.kind === "partner") {
			partners++;
			continue;
		}
		if (edge.kind === "child") {
			family++;
			continue;
		}
		if (!edge.relationKind) continue;

		const { category } = RELATION_KINDS[edge.relationKind];
		categories[category]++;
		kindSets[category].add(edge.relationKind);
		// An ended relation is drawn in the past rhythm whatever its kind, so its
		// weight is not what the closeness scale is showing.
		if (edge.ended) ended++;
		else weights.add(edge.closeness ?? 1);
	}

	const provenance: Record<Verification, number> = {
		documented: 0,
		self_confirmed: 0,
		family_recalled: 0,
		unverified: 0,
		disputed: 0,
	};

	let livingCount = 0;
	let deceased = 0;
	let livingUnknown = 0;
	let conflicted = 0;
	let merged = 0;
	let withPhone = 0;
	let withHandle = 0;
	let ringed = 0;

	for (const node of nodes) {
		if (node.type !== "person") continue;
		const person = node.data;

		switch (person.primary.living) {
			case "deceased":
				deceased++;
				break;
			case "unknown":
				livingUnknown++;
				break;
			default:
				livingCount++;
		}

		provenance[person.trust.level]++;
		if (person.trust.conflicted) conflicted++;
		if (person.contributingTreeIds.length > 1) merged++;

		const contacts = person.contacts ?? [];
		// The same split the card draws: phone and WhatsApp share one glyph, every
		// other channel shares the other.
		if (contacts.some((c) => c.kind === "phone" || c.kind === "whatsapp")) withPhone++;
		if (contacts.some((c) => c.kind !== "phone" && c.kind !== "whatsapp")) withHandle++;

		if ((degree?.get(node.id)?.rank ?? 0) > RING_MIN_RANK) ringed++;
	}

	return {
		family,
		partners,
		categories,
		kinds: {
			kin: [...kindSets.kin],
			social: [...kindSets.social],
			professional: [...kindSets.professional],
			care: [...kindSets.care],
			other: [...kindSets.other],
		},
		ended,
		closenessLevels: weights.size,
		living: livingCount,
		deceased,
		livingUnknown,
		provenance,
		conflicted,
		merged,
		withPhone,
		withHandle,
		ringed,
	};
}
