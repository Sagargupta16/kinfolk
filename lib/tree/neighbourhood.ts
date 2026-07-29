/**
 * Who is immediately connected to one person, for hover focus.
 *
 * Not simple adjacency, because a person is never joined directly to their
 * partner or their child: both go via the union dot (parent -> union -> child).
 * Plain neighbours of a person are therefore mostly junction dots, which is
 * useless to light up. So hierarchical edges are traversed one extra hop
 * THROUGH union nodes, and stop there -- one more hop would reach a sibling's
 * spouse's family and the highlight would swallow the tree.
 *
 * Relation edges join two people directly, so they need no expansion.
 */
import type { FlowEdge } from "./graph";

export type Neighbourhood = {
	/** Nodes to keep lit, including the focused person and any union dots between. */
	nodeIds: Set<string>;
	edgeIds: Set<string>;
};

export function neighbourhood(
	edges: FlowEdge[],
	focusedId: string,
	isUnion: (id: string) => boolean,
): Neighbourhood {
	const nodeIds = new Set([focusedId]);
	const edgeIds = new Set<string>();

	// Pass one: everything directly touching the focused person.
	const unions: string[] = [];
	for (const edge of edges) {
		const other =
			edge.source === focusedId ? edge.target : edge.target === focusedId ? edge.source : null;
		if (other === null) continue;

		edgeIds.add(edge.id);
		nodeIds.add(other);
		if (isUnion(other)) unions.push(other);
	}

	// Pass two: through the union dots only. This is what reaches the partner on
	// the other side of the dot and the children hanging below it.
	for (const edge of edges) {
		const touched = unions.includes(edge.source)
			? edge.target
			: unions.includes(edge.target)
				? edge.source
				: null;
		if (touched === null) continue;

		edgeIds.add(edge.id);
		nodeIds.add(touched);
	}

	return { nodeIds, edgeIds };
}
