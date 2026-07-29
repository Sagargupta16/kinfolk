/**
 * Layout via ELK's layered algorithm.
 *
 * Hand-rolled generation-band layout breaks the moment the data is real:
 * cousins marry, adoptions cross generations, and a "depth" integer stops
 * existing. ELK solves layer assignment as a graph problem, so those cases
 * degrade gracefully instead of overlapping nodes.
 *
 * Union nodes are sized near-zero so they read as a junction dot rather than a
 * box, which is what makes a couple look like a couple.
 */
import type { FlowEdge, FlowNode } from "./graph";

/**
 * How much of a person is drawn.
 *
 * Progressive disclosure, and the reason it reaches the LAYOUT rather than only
 * the card: shrinking a card in CSS alone leaves ELK reserving the full 200x92,
 * so a tree of dots would keep card-sized gaps and none of the promised overview.
 * The whole point of collapsing to a dot is that the shape of the family fits on
 * one screen, which only happens if the spacing collapses with it.
 *
 *   full    -- the archive card: name, dates, provenance, channels
 *   compact -- name and dates, for reading a wide tree
 *   dot     -- a node, for seeing the shape of a large one
 */
export type Lod = "full" | "compact" | "dot";

type Metrics = {
	width: number;
	height: number;
	/** elk.spacing.nodeNode: horizontal gap within a generation. */
	gap: number;
	/** elk.layered.spacing.nodeNodeBetweenLayers: gap between generations. */
	rowGap: number;
};

/**
 * Gaps shrink faster than the cards do.
 *
 * Scaling spacing in proportion to the node would keep the tree exactly as wide
 * in screen terms and collapse would buy nothing. These are tuned so each step
 * roughly halves the footprint.
 */
export const NODE_METRICS: Record<Lod, Metrics> = {
	full: { width: 200, height: 92, gap: 40, rowGap: 80 },
	compact: { width: 168, height: 44, gap: 26, rowGap: 52 },
	dot: { width: 16, height: 16, gap: 18, rowGap: 40 },
};

export const PERSON_WIDTH = NODE_METRICS.full.width;
export const PERSON_HEIGHT = NODE_METRICS.full.height;
const UNION_SIZE = 12;

export type PositionedNode = FlowNode & {
	position: { x: number; y: number };
	width: number;
	height: number;
};

/**
 * A horizontal band holding one generation.
 *
 * Derived from the laid-out person rows rather than from a depth counter, because
 * after ELK runs the y coordinate IS the generation -- and a counter would have to
 * re-answer the question ELK just solved, differently, for cousin marriages and
 * cross-generation adoptions.
 */
export type GenerationBand = {
	/** Row centre, for placing the label. */
	y: number;
	top: number;
	bottom: number;
	left: number;
	right: number;
	/** How many people sit in this band. */
	count: number;
};

export type LayoutResult = {
	nodes: PositionedNode[];
	bands: GenerationBand[];
	/** The box every node fits inside. See `graphExtent`. */
	extent: Box;
};

/** Exported for the minimap, which shapes its own panel from the graph extent. */
export type Box = { x: number; y: number; width: number; height: number };

/**
 * The box the whole laid-out graph occupies.
 *
 * Returned with the layout because layout is the only thing that knows it: the
 * numbers are the positions it just assigned, and any consumer recomputing them
 * would either duplicate the sizing table or read measured DOM boxes that do not
 * exist until React Flow has painted.
 *
 * The overview minimap needs it to choose its own aspect ratio, and that has to be
 * derived rather than picked: this tree measures 10760x1137 as cards (9.5:1) and
 * 1512x488 as dots (3.1:1), so one fixed box would spend most of its area on empty
 * space at whichever level it was not tuned for.
 */
export function graphExtent(nodes: PositionedNode[]): Box {
	if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;

	// Every node, union dots included -- unlike generation bands, which are about
	// people. A dot is drawn, so a box that excluded it would clip the canvas.
	for (const node of nodes) {
		left = Math.min(left, node.position.x);
		top = Math.min(top, node.position.y);
		right = Math.max(right, node.position.x + node.width);
		bottom = Math.max(bottom, node.position.y + node.height);
	}

	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * ELK ships as a bundled worker-less build; importing it lazily keeps it out of
 * the initial page payload since layout only runs once the graph is loaded.
 */
async function loadElk() {
	const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
	return new ELK();
}

export async function layoutGraph(
	nodes: FlowNode[],
	edges: FlowEdge[],
	lod: Lod = "full",
): Promise<LayoutResult> {
	if (nodes.length === 0)
		return { nodes: [], bands: [], extent: { x: 0, y: 0, width: 0, height: 0 } };

	const elk = await loadElk();
	const metrics = NODE_METRICS[lod];

	const graph = {
		id: "root",
		layoutOptions: {
			"elk.algorithm": "layered",
			// Generations read top-to-bottom, the convention every family tree uses.
			"elk.direction": "DOWN",
			"elk.layered.spacing.nodeNodeBetweenLayers": String(metrics.rowGap),
			"elk.spacing.nodeNode": String(metrics.gap),
			// Keeps siblings in the order they were entered rather than reshuffling
			// them on every reload.
			"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
			"elk.layered.crossingMinimization.semiInteractive": "true",
			"elk.edgeRouting": "ORTHOGONAL",
		},
		children: nodes.map((node) => ({
			id: node.id,
			width: node.type === "union" ? UNION_SIZE : metrics.width,
			height: node.type === "union" ? UNION_SIZE : metrics.height,
		})),
		// Only hierarchical edges. A friendship or a cousinhood carries no
		// generation, so including it here would pull that person into a lower
		// layer and misrepresent the family. Those edges are drawn as an overlay
		// on top of the family layout instead.
		edges: edges
			.filter((edge) => edge.layout)
			.map((edge) => ({
				id: edge.id,
				sources: [edge.source],
				targets: [edge.target],
			})),
	};

	const laid = await elk.layout(graph);
	const positions = new Map<string, Box>(
		(laid.children ?? []).map((child) => [
			child.id as string,
			{ x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 },
		]),
	);

	anchorFamilylessNodes(nodes, edges, positions, metrics.gap);

	const positioned = nodes.map((node) => {
		const box = positions.get(node.id);
		return {
			...node,
			position: { x: box?.x ?? 0, y: box?.y ?? 0 },
			width: box?.width ?? metrics.width,
			height: box?.height ?? metrics.height,
		};
	});

	return {
		nodes: positioned,
		bands: generationBands(positioned, metrics.height),
		extent: graphExtent(positioned),
	};
}

/**
 * Group the laid-out people into horizontal bands, one per generation.
 *
 * Person nodes only: union dots sit BETWEEN rows, so including them would invent
 * half-generations. Rows are keyed on the y ELK assigned, which is already
 * uniform within a layer.
 */
function generationBands(nodes: PositionedNode[], personHeight: number): GenerationBand[] {
	const rows = new Map<number, PositionedNode[]>();

	for (const node of nodes) {
		if (node.type !== "person") continue;
		const existing = rows.get(node.position.y);
		if (existing) existing.push(node);
		else rows.set(node.position.y, [node]);
	}

	return [...rows.entries()]
		.sort(([a], [b]) => a - b)
		.map(([y, members]) => ({
			y: y + personHeight / 2,
			top: y,
			bottom: y + Math.max(...members.map((m) => m.height)),
			left: Math.min(...members.map((m) => m.position.x)),
			right: Math.max(...members.map((m) => m.position.x + m.width)),
			count: members.length,
		}));
}

/**
 * Place people who have no family edge beside somebody they actually know.
 *
 * ELK only saw hierarchical edges, so a friend with no parents and no partner is
 * an isolated node: it gets dropped into the first layer, which reads as "older
 * than the grandparents". That is worse than being unplaced, because the canvas
 * asserts a generation that does not exist.
 *
 * So they are positioned afterwards, to the right of their best-known contact
 * and on that person's row. This runs after layout rather than as an ELK
 * constraint on purpose: the family skeleton must not shift to accommodate a
 * friend, which is the invariant layout.test.ts pins down.
 */
function anchorFamilylessNodes(
	nodes: FlowNode[],
	edges: FlowEdge[],
	positions: Map<string, Box>,
	/** Matches elk.spacing.nodeNode, so anchored nodes sit on the same rhythm. */
	gap: number,
): void {
	const inFamily = new Set<string>();
	for (const edge of edges) {
		if (!edge.layout) continue;
		inFamily.add(edge.source);
		inFamily.add(edge.target);
	}

	const floating = nodes.filter((node) => !inFamily.has(node.id));
	if (floating.length === 0 || floating.length === nodes.length) return;

	// Anchor to whoever they know who is themselves anchored. Resolved in passes
	// so a friend-of-a-friend still lands somewhere sensible.
	const pending = new Set(floating.map((n) => n.id));
	// Rows fill left to right, so two friends of one person do not stack.
	const occupied = new Map<number, number>();
	for (const [id, box] of positions) {
		if (pending.has(id)) continue;
		occupied.set(box.y, Math.max(occupied.get(box.y) ?? 0, box.x + box.width));
	}

	let progressed = true;
	while (pending.size > 0 && progressed) {
		progressed = false;

		for (const id of [...pending]) {
			const anchorId = edges.find(
				(edge) =>
					!edge.layout &&
					((edge.source === id && !pending.has(edge.target)) ||
						(edge.target === id && !pending.has(edge.source))),
			);
			if (!anchorId) continue;

			const otherId = anchorId.source === id ? anchorId.target : anchorId.source;
			const anchor = positions.get(otherId);
			const box = positions.get(id);
			if (!anchor || !box) continue;

			const rowEnd = occupied.get(anchor.y) ?? anchor.x + anchor.width;
			box.x = rowEnd + gap;
			box.y = anchor.y;
			occupied.set(anchor.y, box.x + box.width);
			pending.delete(id);
			progressed = true;
		}
	}
}
