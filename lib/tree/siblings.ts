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
 * So the bar gets its own lane. Each lane takes the most families whose bars can
 * share it, lane 0 first, so non-overlapping families still share a line and the
 * tree keeps one clean line per generation wherever it can.
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
	/**
	 * 0 runs through the middle of the gap, 1 just below it, 2 just above, and so on
	 * outward. For tests and debugging.
	 */
	lane: number;
};

/**
 * Vertical distance between lanes, when the gap has room for it.
 *
 * Small: the bar has to stay clearly in the gap between two generations, and
 * lanes exist to be distinguishable rather than separated. 9px is enough to read
 * as two lines at the 0.55 zoom the card level bottoms out at, where it is ~5
 * screen pixels. A gap that needs more lanes than fit at 9px packs them closer
 * instead (see `laneStep`), because two families on one line is the one way the
 * bar can say the wrong thing about whose child is whose.
 */
const LANE_HEIGHT = 9;

/** The shortest drop from a bar to a child: room for its rounded corner to turn. */
const MIN_DROP = 10;

/**
 * The step between lanes in one gap, so every lane stays inside it.
 *
 * There used to be a cap of three lanes and then a wrap onto the least crowded one,
 * on the reasoning that three interleaved families was rare. On the Wikidata sample it
 * is not: intermarried dynasties put each child beside their spouse's household, so
 * one generation holds six families whose children overlap at a single x, and the
 * wrap drew six pairs of them on one shared line. Lanes are now unbounded and their
 * spacing shrinks to fit: lane 0 in the middle, the rest alternating either side,
 * the outermost a fifth of the gap clear of both rows (never under `MIN_DROP`) --
 * spread to the very edge, the outer lines looked like they touched the cards.
 */
function laneStep(gapHeight: number, lanes: number): number {
	const steps = Math.ceil((lanes - 1) / 2);
	if (steps === 0) return LANE_HEIGHT;
	const clearance = Math.max(MIN_DROP, gapHeight * 0.2);
	return Math.min(LANE_HEIGHT, Math.max(0, gapHeight / 2 - clearance) / steps);
}

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

	/**
	 * Where the row above a gap ends: the bottom of the nearest cards above the children.
	 *
	 * The bar sits halfway between that and the children's top, so the line coming down to
	 * it and the drops leaving it are the same length. It used to sit a fixed 9px above the
	 * children whatever the gap, which left its rounded corners almost touching their cards
	 * while the line from the parents ran most of the way down.
	 */
	const rowAbove = (top: number) => {
		let bottom = Number.NEGATIVE_INFINITY;
		for (const node of nodes) {
			if (node.type !== "person") continue;
			const end = node.position.y + node.height;
			if (end <= top && end > bottom) bottom = end;
		}
		return bottom;
	};

	for (const [top, gap] of byGap) {
		/*
		 * Each lane takes the MOST families that can share it, lane 0 first: earliest-
		 * finishing first, the activity-selection rule, which is optimal for one line.
		 * Lane 0 is the one that runs exactly through the middle of the gap, so this puts
		 * as many families as the picture allows at equal gaps above and below.
		 */
		type Candidate = (typeof gap)[number];
		const placed: Array<{ candidate: Candidate; lane: number }> = [];
		let remaining = [...gap].sort((a, b) => a.right - b.right || a.left - b.left);
		let lanes = 0;
		while (remaining.length > 0) {
			const rest: Candidate[] = [];
			let end = Number.NEGATIVE_INFINITY;
			for (const candidate of remaining) {
				// Touching counts as overlapping: two bars meeting end to end read as one.
				if (candidate.left > end) {
					placed.push({ candidate, lane: lanes });
					end = candidate.right;
				} else {
					rest.push(candidate);
				}
			}
			remaining = rest;
			lanes += 1;
		}

		/*
		 * Measured from the ROWS, not from the union down. The union dot's own y varies with
		 * how its partners were placed, while the two rows are uniform -- so every bar in a
		 * generation keeps the same rhythm, which is what makes lane 0 read as one line.
		 * Lane 0 runs exactly through the middle of the gap; only a family that overlaps
		 * another steps off it, lane 1 one step below and lane 2 one step above. Centring
		 * the whole stack instead put every lane-0 bar 4.5px off centre for the sake of the
		 * few that needed a second lane (measured: 14 of 18 such bars were lane 0). With no
		 * row above, there is nothing to centre against and the bar keeps its old place.
		 */
		const above = rowAbove(top);
		const middle = Number.isFinite(above) ? (above + top) / 2 : top - LANE_HEIGHT;
		const spacing = Number.isFinite(above) ? laneStep(top - above, lanes) : LANE_HEIGHT;
		for (const { candidate, lane } of placed) {
			const step = Math.ceil(lane / 2) * (lane % 2 === 1 ? 1 : -1);
			const y = middle + step * spacing;
			bars.set(candidate.unionNodeId, {
				unionId: candidate.unionId,
				unionNodeId: candidate.unionNodeId,
				// Never above the parents. A bar that overshoots its own union dot points
				// the drop line upwards, which reads as the children being the ancestors.
				// Never so low that a drop has no length to turn its corner in.
				y: Math.min(Math.max(y, candidate.unionBottom + 2), top - MIN_DROP),
				left: candidate.left,
				right: candidate.right,
				lane,
			});
		}
	}

	return bars;
}
