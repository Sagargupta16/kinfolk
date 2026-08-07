export type ParentEdge = {
	parentId: string;
	childId: string;
};

/**
 * Whether adding parent -> child would close a directed ancestry cycle.
 *
 * A cycle is created when the proposed child already reaches one of the proposed
 * parents by following descendants.
 */
export function wouldCreateAncestryCycle(
	edges: readonly ParentEdge[],
	parentIds: readonly string[],
	childId: string,
): boolean {
	const proposedParents = new Set(parentIds);
	if (proposedParents.size === 0) return false;

	const children = new Map<string, string[]>();
	for (const edge of edges) {
		const current = children.get(edge.parentId);
		if (current) current.push(edge.childId);
		else children.set(edge.parentId, [edge.childId]);
	}

	const seen = new Set<string>();
	const pending = [childId];

	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || seen.has(current)) continue;
		if (proposedParents.has(current)) return true;

		seen.add(current);
		pending.push(...(children.get(current) ?? []));
	}

	return false;
}
