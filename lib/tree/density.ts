/**
 * How connected each person is, so the canvas can draw a hub differently from a
 * leaf.
 *
 * This is the "show immediate connections more densely" half of the graph: a
 * matriarch with a partner, six children and four friends should look like the
 * centre of something, and a cousin recorded once should not. Cambridge
 * Intelligence's guidance is the reason it is computed rather than styled by
 * hand -- size and weight are pre-attentive channels, so getting them wrong
 * misleads faster than a bad label does.
 *
 * Two deliberate choices:
 *
 *   1. Union dots are traversed THROUGH, not counted. A dot is scaffolding; a
 *      person whose only edge is to their own union is not connected to anything
 *      yet, and counting the dot would rank them equal to someone with a friend.
 *   2. Family and social ties are counted SEPARATELY. They are not commensurate
 *      -- eight children is not the same fact as eight colleagues -- and summing
 *      them would let a busy address book outrank a large family.
 *
 * Pure, like everything in lib/tree: no React, no DB.
 */
import type { FlowEdge, FlowNode } from "./graph";

export type Degree = {
	/** Partners, parents and children, counted through union dots. */
	family: number;
	/** Relation edges, weighted by closeness so a close friend counts for more. */
	social: number;
	/**
	 * Combined 0..1 rank against the busiest person in this graph.
	 *
	 * Relative, not absolute: a five-person tree has its own hub, and a fixed
	 * scale would render every node in a small tree as equally peripheral.
	 */
	rank: number;
};

/**
 * Count real connections per person id.
 *
 * Returns a Map so callers can look up by node id without a second pass; nodes
 * absent from any edge still get an entry, because a zero degree is a fact worth
 * rendering and an undefined lookup is a bug waiting to happen.
 */
export function degrees(nodes: FlowNode[], edges: FlowEdge[]): Map<string, Degree> {
	const unionIds = new Set(nodes.filter((n) => n.type === "union").map((n) => n.id));

	/** Everyone attached to each union dot, so it can be traversed through. */
	const unionMembers = new Map<string, Set<string>>();
	for (const id of unionIds) unionMembers.set(id, new Set());

	const family = new Map<string, number>();
	const social = new Map<string, number>();
	for (const node of nodes) {
		if (unionIds.has(node.id)) continue;
		family.set(node.id, 0);
		social.set(node.id, 0);
	}

	for (const edge of edges) {
		if (edge.kind === "relation") {
			// Weighted, so three acquaintances do not outweigh one sibling-like bond.
			const weight = edge.closeness ?? 1;
			bump(social, edge.source, weight);
			bump(social, edge.target, weight);
			continue;
		}

		// Hierarchical: exactly one end is a union dot in a well-formed graph.
		for (const [end, other] of [
			[edge.source, edge.target],
			[edge.target, edge.source],
		] as const) {
			if (unionIds.has(end) && !unionIds.has(other)) unionMembers.get(end)?.add(other);
		}
	}

	// Everyone sharing a union dot is connected to everyone else on it: partners to
	// each other, parents to children, siblings to siblings.
	for (const members of unionMembers.values()) {
		if (members.size < 2) continue;
		for (const id of members) bump(family, id, members.size - 1);
	}

	const peak = Math.max(
		1,
		...[...family.keys()].map((id) => (family.get(id) ?? 0) + (social.get(id) ?? 0)),
	);

	const out = new Map<string, Degree>();
	for (const id of family.keys()) {
		const f = family.get(id) ?? 0;
		const s = social.get(id) ?? 0;
		out.set(id, { family: f, social: s, rank: (f + s) / peak });
	}
	return out;
}

function bump(counter: Map<string, number>, id: string, by: number): void {
	const current = counter.get(id);
	// Undefined means the id is a union dot or unknown; either way not a person to
	// score, and silently creating an entry would invent a node.
	if (current === undefined) return;
	counter.set(id, current + by);
}
