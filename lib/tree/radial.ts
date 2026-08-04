/**
 * The orbit view: one person at the centre, everybody else on rings around them.
 *
 * A generation-banded pedigree answers "where does this family sit in time". It cannot
 * answer "who surrounds THIS person", because the people closest to somebody are scattered
 * across the width of a canvas 10760px wide -- a mother two rows up, a friend anchored
 * beside a stranger, a cousin 4000px sideways. Distance on the layered canvas encodes
 * generation, not closeness, so proximity to a person is exactly the one thing it cannot
 * show.
 *
 * The orbit inverts that: radius IS distance from the focus, measured in hops through the
 * graph, so everyone on ring 1 genuinely touches the centre and ring 2 is one step further
 * out. It answers the contact-graph half of Kinfolk the way the layered view answers the
 * pedigree half, and neither is a replacement for the other.
 *
 * Pure arithmetic, no React and no DB, for the same reason the rest of lib/tree is: an
 * overlapping ring or a node placed at the wrong angle is a claim about a family that a
 * reader believes without checking.
 *
 * Screen coordinates throughout: y grows DOWNWARD, and angles are measured clockwise from
 * twelve o'clock so that "first child" reads top-left the way a list does.
 */
import type { FlowEdge, FlowNode } from "./graph";
import type { Box, Lod, PositionedNode } from "./layout";
import { NODE_METRICS } from "./layout";

/**
 * A laid-out node, carrying the ring it landed on.
 *
 * Extends `PositionedNode` rather than defining its own shape, and that is not a
 * convenience: the canvas builds React Flow nodes from `type` and `data`, so a bespoke
 * type would need a second copy of that construction -- roughly eighty lines whose two
 * versions would drift on the first change. Both arrangements return the same thing plus
 * whatever is peculiar to them.
 */
export type RadialNode = PositionedNode & {
	/** Hops from the focus. 0 is the focus itself. */
	ring: number;
	/** Where on its ring, in radians clockwise from twelve o'clock. Undefined for the focus. */
	angle?: number;
};

export type RadialResult = {
	nodes: RadialNode[];
	/** Radius of each ring, indexed by ring number. `rings[0]` is always 0. */
	rings: number[];
	extent: Box;
};

/**
 * Family edges rewritten person-to-person, for a graph with no junctions drawn.
 *
 * The orbit places people only, so a `partner` edge to a union and a `child` edge from one
 * both dangle. Collapsing them here rather than in the canvas keeps the transform next to
 * the layout that requires it, and keeps it testable.
 *
 * Partners of one union become a single edge between the two people; a child becomes one
 * edge per parent. That is more edges than the junction form (2 + N becomes 1 + 2N), which
 * is the cost of the junction going away -- and acceptable because the orbit shows at most a
 * few rings rather than the whole graph.
 */
export function collapseUnionEdges(nodes: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
	const unions = new Map<string, { partners: string[]; children: string[] }>();
	for (const node of nodes) {
		if (node.type === "union") unions.set(node.id, { partners: [], children: [] });
	}

	const direct: FlowEdge[] = [];

	for (const edge of edges) {
		const asSource = unions.get(edge.source);
		const asTarget = unions.get(edge.target);

		// A child edge runs union -> person; a partner edge runs person -> union.
		if (asSource) asSource.children.push(edge.target);
		else if (asTarget) asTarget.partners.push(edge.source);
		// Anything touching no junction (every relation edge) passes straight through.
		else direct.push(edge);
	}

	for (const [unionId, { partners, children }] of unions) {
		for (let i = 0; i < partners.length; i += 1) {
			for (let j = i + 1; j < partners.length; j += 1) {
				direct.push({
					id: `pp:${unionId}:${partners[i]}:${partners[j]}`,
					source: partners[i] as string,
					target: partners[j] as string,
					kind: "partner",
					layout: true,
				});
			}
		}

		for (const child of children) {
			for (const parent of partners) {
				direct.push({
					id: `pc:${unionId}:${parent}:${child}`,
					source: parent,
					target: child,
					kind: "child",
					layout: true,
				});
			}
		}
	}

	return direct;
}

/**
 * Gap between one node's slot and the next, along a ring's arc.
 *
 * Larger than the layered view's 32px node gap because an arc's chord is shorter than its
 * arc length: two cards on the same ring are closer together in a straight line than the
 * spacing maths suggests, and the difference grows as the ring gets tighter.
 */
const ARC_GAP = 44;

/**
 * Space between consecutive rings, on top of the node height.
 *
 * Paid once PER RING, so it compounds outward -- at 96 with junctions counted as rings the
 * outermost sat at radius 2632, a 5264px-wide orbit wider than the pedigree it is an
 * alternative to. Now that only PEOPLE take rings there are at most four of them, so the gap
 * can be generous again: rings have to be distinguishable, and the empty band between two of
 * them is what makes the arrangement read as concentric rather than as a cloud.
 */
const RING_GAP = 72;

/**
 * How many hops out the orbit draws before it stops.
 *
 * The orbit's whole claim is "here is who is NEAR this person". At 14 hops the outer rings
 * hold twelfth-degree connections, which is not context -- it is the rest of the graph,
 * drawn as a halo. Measured on the sample tree: rings 1 to 4 hold the family a viewer would
 * recognise, and everything past that is people they have never heard of.
 *
 * Cutting is honest here in a way it would not be on the pedigree, because this view never
 * claimed completeness -- the tree does, and it is one click away.
 */
const MAX_RINGS = 4;

/**
 * How much of a parent's arc a ring of children may occupy.
 *
 * Below 1 so the fan stays near the direction its parent sits in: at 1 a lone child
 * inherits the whole wedge and nothing ever narrows, which is the defect the chain test
 * pins. Not much below 1 either -- too small and each generation collapses toward a single
 * ray, leaving the outer rings sparse and the circle mostly empty.
 *
 * 0.72 keeps a four-child fan inside roughly a quarter turn at ring 3 while still filling
 * the circle at ring 1, where the focus's whole 360 is in play.
 */
const WEDGE_DECAY = 0.72;

/**
 * How many nodes may share one ring before it splits into sub-rings.
 *
 * A ring holding 45 people needs a radius of about 1500px, which puts ring 1 further from
 * the centre than ring 3 would otherwise be and defeats the whole point -- radius is
 * supposed to mean distance. Splitting a crowded ring into two nearby radii keeps the
 * ordering true while holding the diameter down.
 */
const MAX_PER_RING = 18;

/**
 * Hops from the focus to every reachable PERSON, traversing THROUGH union dots.
 *
 * A junction is not a step in a relationship. Counting it as one was the first
 * implementation and it broke the view twice over:
 *
 *   - Semantically, "ring 2" then meant a mix of parents, children and nobody-in-particular,
 *     while a spouse sat alone on ring 1. CLAUDE.md already puts it exactly: a union dot is
 *     "the MARRIAGE, not a route to the children".
 *   - Geometrically, every other ring was made of 12x12 dots that still consumed a full
 *     168px ring step, so half the radius went on junctions. Measured: rings reached 3641px
 *     with one edge at 6154px, which made the orbit wider than the pedigree it is an
 *     alternative to.
 *
 * So a union is traversed rather than counted, and a ring means "people I am N relationships
 * from" -- which is the question this view exists to answer.
 */
export function hopsFrom(
	edges: FlowEdge[],
	focusId: string,
	/** True for ids that are junctions rather than people. */
	isUnion: (id: string) => boolean = () => false,
): Map<string, number> {
	const neighbours = new Map<string, string[]>();
	for (const edge of edges) {
		push(neighbours, edge.source, edge.target);
		push(neighbours, edge.target, edge.source);
	}

	/** Everybody one relationship from `id`, seeing through any junctions between. */
	const peopleNear = (id: string): string[] => {
		const found: string[] = [];
		for (const direct of neighbours.get(id) ?? []) {
			if (!isUnion(direct)) {
				found.push(direct);
				continue;
			}
			// Step through the junction to whoever else it joins, but never back to `id`.
			for (const beyond of neighbours.get(direct) ?? []) {
				if (beyond !== id && !isUnion(beyond)) found.push(beyond);
			}
		}
		return found;
	};

	const hops = new Map<string, number>([[focusId, 0]]);
	let frontier = [focusId];
	let depth = 0;

	// Breadth-first, so the SHORTEST route wins: in a graph where two branches rejoin, the
	// same cousin is reachable at several depths and only the nearest is the honest one.
	while (frontier.length > 0) {
		depth += 1;
		const next: string[] = [];
		for (const id of frontier) {
			for (const other of peopleNear(id)) {
				if (hops.has(other)) continue;
				hops.set(other, depth);
				next.push(other);
			}
		}
		frontier = next;
	}

	return hops;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
	const existing = map.get(key);
	if (existing) existing.push(value);
	else map.set(key, [value]);
}

/**
 * The minimum radius a ring needs to hold `count` nodes without them touching.
 *
 * Each node claims an arc long enough for its own width plus a gap. Summed, those arcs are
 * the circumference, so `2 * PI * r >= count * (width + gap)` and the radius follows. This
 * is why a fixed radius per ring fails: at 45 nodes the required radius is roughly seven
 * times what 6 nodes need, and a fixed value either wastes the whole canvas or overlaps
 * every card on the busy ring.
 */
export function ringRadius(count: number, nodeWidth: number, gap = ARC_GAP): number {
	if (count <= 1) return 0;
	return ((count * (nodeWidth + gap)) / (2 * Math.PI)) as number;
}

/**
 * Lay the graph out as rings around `focusId`.
 *
 * Nodes unreachable from the focus are omitted entirely rather than parked somewhere: this
 * view's whole claim is that distance from the centre means distance from that person, and
 * a node with no path has no honest radius. The caller decides what to say about them.
 */
export function radialLayout(
	nodes: FlowNode[],
	edges: FlowEdge[],
	focusId: string,
	lod: Lod = "full",
): RadialResult {
	const metrics = NODE_METRICS[lod];
	const empty: RadialResult = {
		nodes: [],
		rings: [0],
		extent: { x: 0, y: 0, width: 0, height: 0 },
	};

	if (nodes.length === 0) return empty;
	// A focus that is not in the graph cannot anchor anything, and guessing one would put a
	// stranger at the centre of somebody's family.
	if (!nodes.some((node) => node.id === focusId)) return empty;

	const unionIds = new Set(nodes.filter((node) => node.type === "union").map((node) => node.id));

	// Relation edges are included on purpose: a friendship carries no generation, but it does
	// carry closeness, and this is the view where "who is near me" is the question, so a close
	// friend belongs on ring 1. Junctions are traversed through rather than counted.
	const hops = hopsFrom(edges, focusId, (id) => unionIds.has(id));

	/** Nodes per ring, in a stable order so the layout does not shuffle between renders. */
	const byRing = new Map<number, FlowNode[]>();
	for (const node of nodes) {
		/*
		 * PEOPLE only. A union dot is not placed on a ring at all.
		 *
		 * It is a marriage rather than a step, so it has no honest radius -- and giving it one
		 * cost a full ring step per generation for a 12x12 mark, which is what took the outermost
		 * ring to 3641px. Partner edges then join two people directly, which is exactly what a
		 * closeness view should draw.
		 */
		if (node.type === "union") continue;
		const ring = hops.get(node.id);
		// Past the cut, and anyone with no path at all: both are omitted rather than parked
		// on an outer ring, because a radius that does not mean distance breaks the encoding
		// this whole arrangement rests on.
		if (ring === undefined || ring > MAX_RINGS) continue;
		const bucket = byRing.get(ring);
		if (bucket) bucket.push(node);
		else byRing.set(ring, [node]);
	}

	/**
	 * Every node's angle, allocated by WEDGE so relatives sit near each other.
	 *
	 * Placing each ring by index alone was the first implementation and it was wrong in a way
	 * curves could not rescue: measured on the sample graph, the median edge spanned 122
	 * degrees of arc and 26 of 34 crossed more than 90, because a parent on ring 1 and its
	 * child on ring 2 were assigned independent positions and routinely landed on opposite
	 * sides of the circle. Every edge then had to cross the middle, which is the tangle no
	 * amount of bowing fixes -- the angles were the defect, not the paths.
	 *
	 * So a node inherits its parent's sector: ring 1 divides the full circle, and each node
	 * beyond that is placed inside the wedge its nearest-in predecessor occupies, splitting
	 * that wedge among its own children. An edge then spans a fraction of a wedge rather than
	 * a diameter.
	 */
	const angles = allocateWedges(byRing, edges, focusId);

	const placed: RadialNode[] = [];
	const rings: number[] = [0];
	let radius = 0;

	const focus = nodes.find((node) => node.id === focusId);
	if (focus) {
		const size = sizeOf(focus, metrics);
		placed.push({
			// Spread FIRST so `type` and `data` come along: the canvas builds its React Flow
			// nodes from those, and this arrangement has to be substitutable for the layered one.
			...focus,
			// Centred on the origin, so the focus's own centre is (0, 0) and every angle on
			// every ring is measured from it.
			position: { x: -size.width / 2, y: -size.height / 2 },
			...size,
			ring: 0,
		});
	}

	const maxRing = Math.max(...byRing.keys());

	for (let ring = 1; ring <= maxRing; ring += 1) {
		const members = byRing.get(ring) ?? [];
		if (members.length === 0) {
			rings[ring] = radius;
			continue;
		}

		/*
		 * A crowded ring is split into concentric sub-rings rather than pushed outward.
		 *
		 * 45 people on one circle needs ~1500px of radius; two sub-rings of 23 need ~760 each
		 * and sit close together, so the ordering that radius encodes still holds while the
		 * canvas stays a third of the size.
		 */
		const subRings = Math.ceil(members.length / MAX_PER_RING);
		const perSub = Math.ceil(members.length / subRings);

		for (let sub = 0; sub < subRings; sub += 1) {
			const slice = members.slice(sub * perSub, (sub + 1) * perSub);
			if (slice.length === 0) continue;

			/*
			 * The radius has to clear the TIGHTEST angular slot on this ring, not the average.
			 *
			 * Wedge allocation packs a family into its parent's sector, so a node's slot can be
			 * far narrower than `2 * PI / count` -- eight children inside a 40 degree wedge get
			 * 5 degrees each. Sizing on the count alone assumes an even spread that no longer
			 * exists, and the no-overlap test caught exactly that once wedges landed. Solving
			 * `slot * r >= width + gap` for the smallest slot is what makes the ring wide enough
			 * for its worst case.
			 */
			/*
			 * The radius is set by the node COUNT, and the angles are then spread evenly.
			 *
			 * Sizing on the tightest wedge slot was tried and abandoned twice, with numbers each
			 * time: solving `slot * r >= width + gap` is unbounded as a slot narrows, so one
			 * crowded family took the ring to 3641px, and after junctions were collapsed away
			 * (which gives each person more neighbours) to 9291px with a 17024px edge. Capping it
			 * then broke the no-overlap guarantee instead, because the slot arithmetic and the cap
			 * cannot both hold.
			 *
			 * So the two concerns are separated. `ringRadius` gives the radius that fits this many
			 * cards, full stop -- bounded, and monotonic in the count. Wedge allocation is used
			 * only to ORDER the ring, not to space it: nodes are sorted by their allocated angle
			 * and then placed at even intervals, so families stay contiguous (which is what keeps
			 * edges short) while every card gets an equal slot (which is what stops overlap).
			 */
			const ordered = [...slice].sort((a, b) => (angles.get(a.id) ?? 0) - (angles.get(b.id) ?? 0));
			const needed = ringRadius(ordered.length, metrics.width);

			/*
			 * Never inside the previous ring: radius has to stay monotonic in hops or the whole
			 * encoding inverts.
			 *
			 * The step clears the card's LARGER dimension, not its height. A card is 168x92 and
			 * cards are placed at every angle, so two on adjacent radii near the twelve o'clock
			 * axis are separated radially but overlap through their widths -- which is exactly
			 * what the no-overlap test caught once RING_GAP came down from 96 to 40. Using the
			 * max makes the step correct at every angle rather than only at three and nine
			 * o'clock.
			 */
			const step = Math.max(metrics.width, metrics.height) + RING_GAP;
			radius = Math.max(radius + step, needed);

			for (const [index, node] of ordered.entries()) {
				const size = sizeOf(node, metrics);
				/*
				 * EVENLY spaced, in the order the wedges put them.
				 *
				 * The allocated angle decides who sits next to whom; this decides how much room
				 * each gets, and every node on a ring gets the same. Using the allocated angle
				 * directly is what made the radius unbounded, since two nodes could be assigned
				 * angles a fraction of a degree apart and the ring then had to grow until 168px
				 * fitted in that gap.
				 *
				 * The half-slot offset keeps a two-node ring from placing one node directly above
				 * the focus and the other directly below, which reads as a vertical line rather
				 * than as a ring.
				 */
				const angle = ((index + 0.5) / ordered.length) * Math.PI * 2;
				const cx = Math.sin(angle) * radius;
				const cy = -Math.cos(angle) * radius;

				placed.push({
					// Spread first, so `type` and `data` survive. See the focus node above.
					...node,
					// Position is a top-left corner for React Flow, so the centre is offset by half
					// the node. Skipping this puts every card a half-card off its own ring.
					position: { x: cx - size.width / 2, y: cy - size.height / 2 },
					...size,
					ring,
					angle,
				});
			}
		}

		rings[ring] = radius;
	}

	return { nodes: placed, rings, extent: extentOf(placed) };
}

/**
 * How much hangs off each node, counted from the OUTSIDE in.
 *
 * A leaf weighs 1; anything else weighs the sum of what attaches to it on the next ring
 * out. That is the number the wedge split needs: a branch's share of the circle should be
 * its share of the people, or the circle either overflows on the crowded side or leaves a
 * hole on the sparse one.
 *
 * Walked from the outermost ring inward so each node's children are already counted when
 * it is reached -- one pass rather than a recursion per node, which on a DAG would revisit
 * a shared descendant once per route to it.
 */
function weighBranches(
	byRing: Map<number, FlowNode[]>,
	adjacency: Map<string, string[]>,
): Map<string, number> {
	const weight = new Map<string, number>();
	if (byRing.size === 0) return weight;

	const maxRing = Math.max(...byRing.keys());

	for (let ring = maxRing; ring >= 1; ring -= 1) {
		const outer = new Set((byRing.get(ring + 1) ?? []).map((node) => node.id));

		for (const node of byRing.get(ring) ?? []) {
			let total = 0;
			for (const other of adjacency.get(node.id) ?? []) {
				if (outer.has(other)) total += weight.get(other) ?? 1;
			}
			// A leaf still needs a slot of its own, so the floor is 1 rather than 0 -- a zero
			// would give it no arc at all and stack it on its neighbour.
			weight.set(node.id, Math.max(total, 1));
		}
	}

	return weight;
}

/** A node's weight, defaulting to one slot for anything unweighed. */
function weightOf(id: string, weights: Map<string, number>): number {
	return weights.get(id) ?? 1;
}

/**
 * Give every node an angle inside the wedge its predecessor holds.
 *
 * Ring 1 splits the whole circle evenly. From there, each ring's nodes are grouped by which
 * node on the ring INSIDE them they attach to, and each group is placed within that
 * parent's wedge -- so a family stays a contiguous fan instead of being scattered around
 * the circle.
 *
 * Nodes with no inward attachment (reachable only sideways, along a relation) fall back to
 * spreading through whatever is left of the circle, which is the honest answer: nothing
 * anchors them to a direction.
 */
function allocateWedges(
	byRing: Map<number, FlowNode[]>,
	edges: FlowEdge[],
	focusId: string,
): Map<string, number> {
	const angles = new Map<string, number>();
	/** Angular extent each node owns, for its own children to be placed inside. */
	const wedges = new Map<string, { from: number; to: number }>();

	const adjacency = new Map<string, string[]>();
	for (const edge of edges) {
		push(adjacency, edge.source, edge.target);
		push(adjacency, edge.target, edge.source);
	}

	/** How many nodes sit outward of each node, for the proportional split below. */
	const subtreeWeight = weighBranches(byRing, adjacency);

	// The focus owns the whole circle; every wedge below is carved out of it.
	wedges.set(focusId, { from: 0, to: Math.PI * 2 });

	const maxRing = byRing.size === 0 ? 0 : Math.max(...byRing.keys());

	for (let ring = 1; ring <= maxRing; ring += 1) {
		const members = byRing.get(ring) ?? [];
		if (members.length === 0) continue;

		const inner = new Set((byRing.get(ring - 1) ?? []).map((node) => node.id));

		/** Members grouped by the inner node they hang from. */
		const groups = new Map<string, FlowNode[]>();
		for (const node of members) {
			const parent = (adjacency.get(node.id) ?? []).find((other) => inner.has(other));
			// Keyed on the focus for ring 1, and for anything with no inward neighbour -- both
			// legitimately spread across the full circle.
			const key = parent ?? focusId;
			const bucket = groups.get(key);
			if (bucket) bucket.push(node);
			else groups.set(key, [node]);
		}

		for (const [parentId, group] of groups) {
			const wedge = wedges.get(parentId) ?? { from: 0, to: Math.PI * 2 };
			const width = wedge.to - wedge.from;

			/*
			 * Each branch takes arc in PROPORTION to how much hangs off it.
			 *
			 * An even split was the first implementation and produced a scatter rather than
			 * rings. Traced: a lone child takes `width / 1`, so it inherits its parent's ENTIRE
			 * wedge -- a chain of single children keeps the full 360 degrees all the way out, and
			 * every one of them sits at the wedge's midpoint. Their own children then fan across
			 * the whole circle from that single point, which is exactly the "clustered with long
			 * lines" picture.
			 *
			 * Weighting by descendant count fixes both halves at once: a branch with thirty
			 * people below it gets a wide arc, one with two gets a narrow one, so the circle
			 * FILLS while each family stays contiguous. It is also the standard solution for
			 * radial tidy-tree layouts, for this reason.
			 */
			const weights = group.map((node) => weightOf(node.id, subtreeWeight));
			const total = weights.reduce((sum, w) => sum + w, 0) || group.length;

			/*
			 * A wedge SHRINKS as it is handed down, even when only one node inherits it.
			 *
			 * Proportional splitting alone did not fix the chain case, and the test caught it: a
			 * lone child's share of its parent's arc is 100%, so it still received the full 360
			 * degrees and its own four children spread across 270 of them. The arc a node needs
			 * is set by what hangs off it, not by how many siblings it happens to have -- so each
			 * generation keeps a FRACTION of what it was given and stays centred on its parent's
			 * direction.
			 *
			 * Centred rather than left-aligned, because the wedge is now narrower than the space
			 * available: aligning to `wedge.from` would push every branch anticlockwise and the
			 * whole graph would spiral away from its parents' angles.
			 */
			const usable = width * WEDGE_DECAY;
			const start = wedge.from + (width - usable) / 2;

			let cursor = start;
			for (const [index, node] of group.entries()) {
				const slice = (usable * (weights[index] ?? 1)) / total;
				const from = cursor;
				cursor += slice;
				angles.set(node.id, from + slice / 2);
				// The node owns exactly its own slice, so its children subdivide THAT and the
				// wedge narrows monotonically outward.
				wedges.set(node.id, { from, to: from + slice });
			}
		}
	}

	return angles;
}

/** Union dots stay small here too: a junction is not a person. */
function sizeOf(node: FlowNode, metrics: { width: number; height: number }) {
	return node.type === "union"
		? { width: 12, height: 12 }
		: { width: metrics.width, height: metrics.height };
}

function extentOf(nodes: RadialNode[]): Box {
	if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;

	for (const node of nodes) {
		left = Math.min(left, node.position.x);
		top = Math.min(top, node.position.y);
		right = Math.max(right, node.position.x + node.width);
		bottom = Math.max(bottom, node.position.y + node.height);
	}

	return { x: left, y: top, width: right - left, height: bottom - top };
}
