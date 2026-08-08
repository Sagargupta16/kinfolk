/**
 * Which people a collapse leaves on the canvas.
 *
 * The brief asks for collapse generations / expand descendants / expand ancestors,
 * and the naive implementation of all three -- hide the subtree under a node -- is
 * wrong for this data model in a way that only shows up on real families. A family
 * tree is a DAG: a person reached through their mother is also reached through their
 * father, so "the subtree below X" is not a set X owns. Collapse X's descendants and
 * a child of X's daughter by somebody outside the collapse would vanish from their
 * other parent's family too.
 *
 * So collapse is defined by REACHABILITY rather than by subtraction. A hidden person
 * is one who cannot be reached from any root without passing through a collapsed
 * node. Anybody with an independent path stays, which is exactly the DAG-safe answer
 * and needs no special case for adoption, remarriage or cousin marriage.
 *
 * Pure, and tested, because the failure mode is silent: a person who disappears from
 * a canvas does not announce that they were dropped for the wrong reason.
 */
import type { FlowEdge, FlowNode } from "./graph";

/**
 * What is folded away, and in which direction.
 *
 * Two sets rather than one, because the two collapses are not symmetric and a person
 * can be both: fold your grandmother's descendants and your grandfather's ancestors,
 * and each hides a different half of the graph through the same node.
 */
export type Collapsed = {
	/** People whose descendants are hidden. */
	descendants: ReadonlySet<string>;
	/** People whose ancestors are hidden. */
	ancestors: ReadonlySet<string>;
};

export const NOTHING_COLLAPSED: Collapsed = {
	descendants: new Set(),
	ancestors: new Set(),
};

export function isCollapsed(collapsed: Collapsed): boolean {
	return collapsed.descendants.size > 0 || collapsed.ancestors.size > 0;
}

/**
 * A hierarchical adjacency, both ways, with union dots kept as real hops.
 *
 * Union dots are traversed rather than flattened away, because parentage is stored on
 * the union: flattening would need a parent -> child edge list that does not exist,
 * and rebuilding one here would duplicate the projection's own logic.
 */
type Skeleton = {
	down: Map<string, string[]>;
	up: Map<string, string[]>;
};

function skeleton(edges: FlowEdge[]): Skeleton {
	const down = new Map<string, string[]>();
	const up = new Map<string, string[]>();

	for (const edge of edges) {
		if (!edge.layout) continue;
		// A childless couple is joined person-to-person, with no union dot between
		// them (see toFlowGraph). That edge is adjacency, not descent: ingesting it
		// here would read the pair as parent-and-child, so folding one partner's
		// descendants would also swallow the other partner's children by a
		// different union, and `foldable` would offer descent controls on people
		// with nothing below them.
		if (edge.kind === "partner" && !edge.target.startsWith("union:")) continue;
		push(down, edge.source, edge.target);
		push(up, edge.target, edge.source);
	}

	return { down, up };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
	const existing = map.get(key);
	if (existing) existing.push(value);
	else map.set(key, [value]);
}

/** Nodes that may not be traversed out of, per direction. */
type Blockades = { down: Set<string>; up: Set<string> };

/**
 * Turn "fold this person's line" into the nodes the walk may not leave.
 *
 * The asymmetry here is the data model showing through, and getting it wrong is the
 * bug this function exists to name. Parentage hangs off the UNION, so folding a
 * mother's descendants blocks the unions she partners in -- not her own outgoing
 * edges, which are the partner edges joining her to those unions. Block the person
 * instead and the couple comes apart: the dot detaches from the very partnership it
 * represents, and the canvas shows a marriage with one participant.
 *
 * It also means folding a mother's descendants folds the father's too, for the same
 * children. That is not a compromise -- they are the same children, and the union is
 * the thing that says so.
 *
 * Upward is the opposite. A person's parent unions ARE their up-edge targets, so the
 * block sits on the person and their own card stays attached to everything below.
 */
function blockades(collapsed: Collapsed, down: Map<string, string[]>, _up: Map<string, string[]>) {
	const blocked: Blockades = { down: new Set(), up: new Set(collapsed.ancestors) };

	for (const id of collapsed.descendants) {
		// Their partnerships, which is where their children hang.
		for (const unionId of down.get(id) ?? []) blocked.down.add(unionId);
	}

	return blocked;
}

/**
 * Everything the walk may start from.
 *
 * Not simply "the roots", and that was the first implementation's bug: the roots ARE
 * the ancestors an upward fold hides, so seeding from them let every folded
 * grandparent back in through the front door and an upward collapse did nothing at
 * all.
 *
 * So a node behind a blockade is disqualified as a seed, and everybody else keeps
 * theirs. That is what makes a fold local -- collapse one person in a tree of 117 and
 * the other 116 are still entry points, where seeding from the collapsed node alone
 * would leave a canvas holding one branch.
 */
function entryPoints(
	nodes: FlowNode[],
	up: Map<string, string[]>,
	down: Map<string, string[]>,
	blocked: Blockades,
	anchors: string[],
	all: Set<string>,
): Set<string> {
	const behind = new Set<string>();
	for (const id of blocked.down) collect(id, down, behind);
	for (const id of blocked.up) collect(id, up, behind);

	const seeds = new Set<string>();
	for (const node of nodes) if (!behind.has(node.id)) seeds.add(node.id);
	// The anchors regardless: a viewer who folded the graph above themselves is behind
	// their own blockade, and dropping them would empty the canvas.
	for (const id of anchors) if (all.has(id)) seeds.add(id);

	return seeds;
}

/** Everything reachable from `start` along one adjacency, excluding `start`. */
function collect(start: string, adjacency: Map<string, string[]>, into: Set<string>): void {
	const queue = [...(adjacency.get(start) ?? [])];

	while (queue.length > 0) {
		const id = queue.pop();
		if (id === undefined || into.has(id)) continue;
		into.add(id);
		for (const next of adjacency.get(id) ?? []) queue.push(next);
	}
}

/**
 * The people still on the canvas, given what has been folded.
 *
 * `anchors` are the nodes a viewer must always be able to see: themselves, and
 * whichever nodes they collapsed. Without them a viewer who collapsed their own
 * ancestors would be walking a graph with no entry point, and everything would be
 * unreachable -- an empty canvas from a gesture that meant "show me less".
 *
 * Relation edges are deliberately not traversed. A friendship carries no generation,
 * so following one would let a collapsed branch stay visible because somebody in it
 * knows somebody outside -- which reads as the collapse having silently failed.
 */
export function visibleAfterCollapse(
	nodes: FlowNode[],
	edges: FlowEdge[],
	collapsed: Collapsed,
	anchors: string[] = [],
): Set<string> {
	const all = new Set(nodes.map((node) => node.id));
	if (!isCollapsed(collapsed)) return all;

	const { down, up } = skeleton(edges);
	const blocked = blockades(collapsed, down, up);
	const starts = entryPoints(nodes, up, down, blocked, anchors, all);
	if (starts.size === 0) return all;

	const reachable = new Set<string>();
	const queue = [...starts];

	while (queue.length > 0) {
		const id = queue.pop();
		if (id === undefined || reachable.has(id)) continue;
		reachable.add(id);

		// A collapsed person is still drawn -- it is their line that is folded, and the
		// card is where the expand control lives. So the block is on LEAVING a node,
		// never on arriving at one.
		if (!blocked.down.has(id)) {
			for (const next of down.get(id) ?? []) if (!reachable.has(next)) queue.push(next);
		}
		if (!blocked.up.has(id)) {
			for (const next of up.get(id) ?? []) if (!reachable.has(next)) queue.push(next);
		}
	}

	/**
	 * A union dot with nothing left to join is dropped.
	 *
	 * It stays reachable whenever one partner survives, so collapsing a couple's
	 * descendants would otherwise leave a dot hanging below them pointing at children
	 * who are no longer drawn -- a junction to nowhere, which reads as a rendering bug
	 * rather than as a fold.
	 */
	for (const node of nodes) {
		if (node.type !== "union" || !reachable.has(node.id)) continue;
		const attached = [...(down.get(node.id) ?? []), ...(up.get(node.id) ?? [])].filter((id) =>
			reachable.has(id),
		);
		if (attached.length < 2) reachable.delete(node.id);
	}

	return reachable;
}

/**
 * How many people a fold is hiding, per collapsed node.
 *
 * The count is the whole affordance: "+12" on a card says there is something to open
 * and roughly how much, where a bare chevron says only that a control exists. Counted
 * against the fully-expanded graph, so the number does not shrink as other branches
 * are folded -- a count that changed when you collapsed somebody else would be
 * describing the canvas rather than the person.
 */
export function hiddenCounts(
	nodes: FlowNode[],
	edges: FlowEdge[],
	collapsed: Collapsed,
): Map<string, number> {
	const counts = new Map<string, number>();
	if (!isCollapsed(collapsed)) return counts;

	const people = new Set(nodes.filter((node) => node.type === "person").map((node) => node.id));
	const visible = visibleAfterCollapse(nodes, edges, collapsed);

	const { down, up } = skeleton(edges);

	for (const direction of ["descendants", "ancestors"] as const) {
		const adjacency = direction === "descendants" ? down : up;

		for (const id of collapsed[direction]) {
			// Everything below (or above) this node that the canvas is no longer showing.
			// Walked per node rather than read off the visible set as a whole, because two
			// collapsed nodes can hide the same person and each card has to report what IT
			// is hiding -- expanding either one brings those people back.
			const seen = new Set<string>();
			collect(id, adjacency, seen);

			const hidden = [...seen].filter((other) => people.has(other) && !visible.has(other)).length;
			if (hidden > 0) counts.set(id, (counts.get(id) ?? 0) + hidden);
		}
	}

	return counts;
}

/**
 * Whether a person has anything to fold in either direction.
 *
 * Drives whether the card draws a control at all. A leaf with no children must not
 * offer to collapse its descendants: a control that does nothing is worse than an
 * absent one, because the reader concludes the feature is broken rather than
 * inapplicable.
 */
export function foldable(edges: FlowEdge[]): Map<string, { down: boolean; up: boolean }> {
	const { down, up } = skeleton(edges);
	const result = new Map<string, { down: boolean; up: boolean }>();

	for (const id of new Set([...down.keys(), ...up.keys()])) {
		result.set(id, {
			down: (down.get(id) ?? []).length > 0,
			up: (up.get(id) ?? []).length > 0,
		});
	}

	return result;
}

/** Toggle one person in one direction, returning a new value. */
export function toggleCollapse(
	collapsed: Collapsed,
	personId: string,
	direction: "descendants" | "ancestors",
): Collapsed {
	const next = new Set(collapsed[direction]);
	if (next.has(personId)) next.delete(personId);
	else next.add(personId);

	return direction === "descendants"
		? { descendants: next, ancestors: collapsed.ancestors }
		: { descendants: collapsed.descendants, ancestors: next };
}

/**
 * Fold everything below a whole generation, addressed by the people in it.
 *
 * "Collapse generations" from the brief. Expressed as a set of person ids rather than
 * a band index, because a band is a layout artefact: it exists only after ELK has
 * run, and a persisted band index would point at a different row as soon as somebody
 * added a great-grandparent.
 */
export function collapseGeneration(collapsed: Collapsed, personIds: string[]): Collapsed {
	const descendants = new Set(collapsed.descendants);
	// Toggling as a group, on the whole row's state rather than per person: a mixed row
	// where half the cards are folded should close, not invert into the other half.
	const allFolded = personIds.every((id) => descendants.has(id));

	for (const id of personIds) {
		if (allFolded) descendants.delete(id);
		else descendants.add(id);
	}

	return { descendants, ancestors: collapsed.ancestors };
}
