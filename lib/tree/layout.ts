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
 *
 * The full card is 168px, down from 200. Width here is not a style choice: the
 * widest generation in the sample tree holds 45 people, so every pixel of pitch is
 * multiplied by 45 and the card width alone decided the canvas was 10760px across.
 * 168 is what the content actually needs -- the p90 name is 15 characters and the
 * longest kinship term ("second cousin once removed") is 26 at 12px mono, both of
 * which fit -- and it is the same width `compact` already used, so the widest thing
 * this tree ever draws was already proven readable at it.
 */
export const NODE_METRICS: Record<Lod, Metrics> = {
	// 92, not 78, and the number is measured rather than chosen: with the kinship term
	// allowed two lines, the card's own content boxes to 92px for the longest term the
	// walk can produce ("great-great-uncle by marriage"). ELK reserves this box, so a card
	// that needs more than it says either overflows its own border or overlaps a
	// neighbour.
	full: { width: 168, height: 92, gap: 32, rowGap: 72 },
	compact: { width: 148, height: 40, gap: 22, rowGap: 48 },
	/*
	 * 56x34, not 16x16, because the dot now carries a first name under it.
	 *
	 * A nameless dot showed the SHAPE of a family and nothing else -- you could see the graph
	 * but not read it, so finding anybody meant going back to cards and losing the overview.
	 * A first name is what fits: measured across all 117 people at 9px mono, a first name needs
	 * 45px at p90 and 51px at the widest, where a FULL name needs 84px and would make this level
	 * nearly as wide as the compact row it exists to be smaller than.
	 *
	 * The gap stays tight (18px) because the label is centred under the mark and the reserved
	 * width already contains it, so neighbouring labels cannot collide.
	 */
	dot: { width: 56, height: 34, gap: 18, rowGap: 44 },
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
			// Centres a couple over their children instead of over their edge bundle.
			//
			// ELK's default is Brandes-Koepf, which optimises for straight edges and on
			// this tree parked the founding couple 4916px LEFT of the graph centre: the
			// top of a family tree hanging off the far edge, which is exactly the
			// "sideways" complaint. Measured across all five strategies on the sample
			// tree (34 unions), the average distance from a union dot to the midpoint of
			// its own children:
			//
			//   BRANDES_KOEPF (default)  465px      root offset -4916
			//   NETWORK_SIMPLEX          171px      root offset   +129
			//   LINEAR_SEGMENTS          142px      root offset   +987
			//   SIMPLE                  1953px      root offset      0
			//
			// LINEAR_SEGMENTS centres children marginally better but drifts the root
			// eight times further, and the root is the one node a viewer looks for first.
			// SIMPLE centres every band perfectly by ignoring edges entirely, which costs
			// 420px of height in crossings and reads as a stack of unrelated rows.
			"elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
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
	centreUnionDots(nodes, edges, positions);

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
 * Slide each union dot to sit between the two people it joins.
 *
 * ELK places the junction to minimise edge crossings, which is the right objective for a
 * layered graph and the wrong position for a marriage: measured on the sample tree, ALL 34
 * couples had their dot off the midpoint between the partners, the worst by 498px. A dot
 * hanging beside a couple rather than between them is what makes the drop to the children
 * look like it leaves from nowhere -- the "not centre aligned" complaint.
 *
 * A post-layout nudge rather than an ELK constraint, for the same reason `siblingBars` is
 * computed afterwards: the skeleton must not shift to accommodate cosmetics, and moving a
 * 12x12 dot cannot introduce an overlap that matters. Only x moves; the y ELK assigned is
 * what keeps the dot in its generation gap.
 *
 * Where the couple's midpoint and the children's midpoint disagree, this prefers the
 * COUPLE. The dot's job is to say "these two are partners"; the bracket below already says
 * which children are theirs, and it spans the children's own extent independently.
 */
function centreUnionDots(nodes: FlowNode[], edges: FlowEdge[], positions: Map<string, Box>): void {
	/** Partners per union node id. */
	const partners = new Map<string, string[]>();
	for (const edge of edges) {
		if (!edge.layout || edge.kind !== "partner") continue;
		const existing = partners.get(edge.target);
		if (existing) existing.push(edge.source);
		else partners.set(edge.target, [edge.source]);
	}

	for (const node of nodes) {
		if (node.type !== "union") continue;
		const dot = positions.get(node.id);
		const couple = partners.get(node.id);
		// A single-parent union has nothing to sit between, so ELK's x is left alone -- the dot
		// already hangs below its one parent, which is the honest picture.
		if (!dot || !couple || couple.length < 2) continue;

		const centres = couple
			.map((id) => positions.get(id))
			.filter((box): box is Box => Boolean(box))
			.map((box) => box.x + box.width / 2);
		if (centres.length < 2) continue;

		const midpoint = (Math.min(...centres) + Math.max(...centres)) / 2;
		dot.x = midpoint - dot.width / 2;
	}
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
