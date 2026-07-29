/**
 * The horizontal bar that joins a set of siblings, and the lane it runs in.
 *
 * A family tree's most-read fact after a name is "these people are brothers and
 * sisters", and the shape that says so is one drop from the parents to a shared
 * bar, then one short drop per child. Six fanning diagonals say the same thing
 * far less clearly, which is why `toFlowGraph` routes children through a union
 * node at all.
 *
 * ## Why this file exists when the bar was already visible
 *
 * React Flow's smoothstep router already puts every child edge of one union
 * through the same horizontal y, so the bar appeared for free. Measured on the
 * sample tree, that y is shared by every union in a generation: 16 unions on the
 * bar at y=919, 11 at y=685, 5 at y=451. Where two of those unions' children
 * spans overlap, their bars are the same line -- and a reader cannot then tell
 * which parents a child hangs from. Two such pairs on the sample tree, on the
 * generation with the widest spans (2400px).
 *
 * So the bar gets its own lane. Lanes are assigned by greedy interval colouring:
 * a union takes the lowest lane whose bars do not overlap its own x-range, which
 * is optimal for intervals and means non-overlapping families still share a lane
 * and the tree keeps one clean line per generation wherever it can.
 *
 * Pure arithmetic, no React: the collision property is the whole point of the
 * file and it is a thing you assert, not a thing you look at.
 */
import type { UnionWithChildren } from "./graph";
import type { PositionedNode } from "./layout";

/** Where one union's sibling bar runs. */
export type SiblingBar = {
	unionId: string;
	/** Node id of the union dot, which is what the edges are keyed on. */
	unionNodeId: string;
	y: number;
	left: number;
	right: number;
	/** 0 is nearest the parents. Exposed for tests and debugging. */
	lane: number;
};

/**
 * Vertical distance between lanes.
 *
 * Small: the bar has to stay clearly in the gap between two generations, and
 * lanes exist to be distinguishable rather than separated. 9px is enough to read
 * as two lines at the 0.55 zoom the card level bottoms out at, where it is ~5
 * screen pixels.
 */
const LANE_HEIGHT = 9;

/**
 * How many lanes may be used before they start reusing the first.
 *
 * A cap rather than unbounded, because the lanes share one inter-generation gap
 * and past a few they would reach the row below. Three families whose children
 * all interleave is rare; three lanes and then a wrap is a better failure than a
 * bar drawn through the middle of a card.
 */
const MAX_LANES = 3;

/**
 * One bar per union that has more than one child on the canvas.
 *
 * Single children are skipped deliberately: a bar joining one person to itself is
 * a line with no meaning, and the plain drop already reads correctly.
 *
 * @param unions Fused unions, whose `childIds` are fused person ids.
 * @param nodes The laid-out graph, for the positions the bar spans.
 */
export function siblingBars(
	unions: UnionWithChildren[],
	nodes: PositionedNode[],
): Map<string, SiblingBar> {
	const box = new Map(nodes.map((node) => [node.id, node]));

	/** Candidate bars, before lanes are assigned. */
	const candidates: Array<Omit<SiblingBar, "lane" | "y"> & { unionBottom: number; top: number }> =
		[];

	for (const union of unions) {
		const dot = box.get(`union:${union.id}`);
		if (!dot) continue;

		const children = union.childIds
			.map((id) => box.get(id))
			.filter((node): node is PositionedNode => Boolean(node));
		if (children.length < 2) continue;

		// Centre to centre, because that is where a drop line leaves and arrives.
		const centres = children.map((child) => child.position.x + child.width / 2);
		candidates.push({
			unionId: union.id,
			unionNodeId: dot.id,
			left: Math.min(...centres),
			right: Math.max(...centres),
			unionBottom: dot.position.y + dot.height,
			top: Math.min(...children.map((child) => child.position.y)),
		});
	}

	/**
	 * Lanes are assigned per GAP, not globally: two families in different
	 * generations can never collide, so making them compete for lanes would push
	 * bars away from their own children for no reason.
	 */
	const byGap = new Map<number, typeof candidates>();
	for (const candidate of candidates) {
		const gap = byGap.get(candidate.top);
		if (gap) gap.push(candidate);
		else byGap.set(candidate.top, [candidate]);
	}

	const bars = new Map<string, SiblingBar>();

	for (const gap of byGap.values()) {
		// Widest first. A wide bar overlaps more neighbours, so placing it while
		// lanes are still free keeps the crowded cases out of the wrapped lane.
		const ordered = [...gap].sort((a, b) => b.right - b.left - (a.right - a.left));
		/** x-ranges already placed, per lane. */
		const lanes: Array<Array<{ left: number; right: number }>> = [];

		for (const candidate of ordered) {
			let lane = lanes.findIndex(
				(occupants) =>
					!occupants.some(
						(other) => candidate.left <= other.right && other.left <= candidate.right,
					),
			);

			if (lane === -1) {
				if (lanes.length < MAX_LANES) {
					lanes.push([]);
					lane = lanes.length - 1;
				} else {
					// Out of lanes. Wrap to the least crowded rather than piling onto the
					// first, which at least spreads the remaining ambiguity.
					lane = lanes.reduce(
						(best, occupants, index) =>
							occupants.length < (lanes[best]?.length ?? Infinity) ? index : best,
						0,
					);
				}
			}

			lanes[lane]?.push({ left: candidate.left, right: candidate.right });

			// Measured from the CHILDREN up, not from the union down. The union dot's own
			// y varies with how its partners were placed, while the children's row is
			// uniform -- so anchoring to the children keeps every bar in a generation on
			// the same rhythm, which is what makes lane 0 read as one line.
			const y = candidate.top - LANE_HEIGHT * (lane + 1);

			bars.set(candidate.unionNodeId, {
				unionId: candidate.unionId,
				unionNodeId: candidate.unionNodeId,
				// Never above the parents. A bar that overshoots its own union dot points
				// the drop line upwards, which reads as the children being the ancestors.
				y: Math.max(y, candidate.unionBottom + 2),
				left: candidate.left,
				right: candidate.right,
				lane,
			});
		}
	}

	return bars;
}

/** Do any two bars in the map share a y and overlap in x? The invariant, as a query. */
export function barCollisions(bars: Map<string, SiblingBar>): number {
	const all = [...bars.values()];
	let collisions = 0;

	for (let i = 0; i < all.length; i += 1) {
		for (let j = i + 1; j < all.length; j += 1) {
			const a = all[i];
			const b = all[j];
			if (!a || !b || a.y !== b.y) continue;
			if (a.left <= b.right && b.left <= a.right) collisions += 1;
		}
	}

	return collisions;
}
