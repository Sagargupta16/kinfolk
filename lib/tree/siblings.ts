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
 * So the bar gets its own lane. Each lane takes the most families whose lines can
 * share it, lane 0 first, so non-overlapping families still share a line and the
 * tree keeps one clean line per generation wherever it can.
 *
 * ## Every line in a gap, not only the bracket
 *
 * A lane holds a family's WHOLE horizontal run: the bracket over its children and the
 * stems that reach it from the junction, which can sit beyond the children's span. A
 * lone child whose card is not directly below its parents turns through a lane too,
 * where it used to take React Flow's smoothstep, whose run lands halfway between the
 * junction and the child: measured on the sample, one ran 18px under its parents' row
 * for 5000px. And a marriage line that has to run through the gap, because somebody
 * stands between the couple, blocks the stretch of lane it crosses. Measured on 0.8.0
 * in production before this: 13 pairs of lines from different families drawn on one y.
 *
 * Pure arithmetic, no React: the collision property is the whole point of the
 * file and it is a thing you assert, not a thing you look at.
 */
import type { FlowEdge, UnionWithChildren } from "./graph";
import type { PositionedNode } from "./layout";

/** Where one union's sibling bar runs. */
export type SiblingBar = {
	unionId: string;
	/** Node id of the union dot, which is what the edges are keyed on. */
	unionNodeId: string;
	y: number;
	/** The children's span, where the bracket runs. Equal for a lone child, who has none. */
	left: number;
	right: number;
	/**
	 * 0 runs through the middle of the gap, 1 just below it, 2 just above, and so on
	 * outward. For tests and debugging.
	 */
	lane: number;
};

/** The shortest drop from a bar to a child: room for its rounded corner to turn. */
const MIN_DROP = 10;

/**
 * Lane geometry for a level, from its generation gap.
 *
 * The step is what keeps two lanes readable as two lines -- 9px on the card level,
 * enough at the 0.55 zoom it bottoms out at -- and the clearance is how far the
 * outermost line stays from the cards above and below: a third of the gap, 24px on
 * the card level, where lane 0 has 36. Both scale with the level's gap.
 *
 * Fixed, rather than squeezed to fit as they used to be: a gap with six lanes packed
 * them 7.2px apart with the outer ones 14px from the cards, and on the sample's
 * intermarried generations those are the lines that looked like they touched the
 * boxes. The gap grows instead (`gapGrowth`, applied by the layout).
 */
function laneMetrics(rowGap: number) {
	return { step: rowGap / 8, clearance: rowGap / 3 };
}

/** Lane 0 in the middle, then one step below, one above, two below... */
const stepOf = (lane: number) => Math.ceil(lane / 2) * (lane % 2 === 1 ? 1 : -1);

/** One family's horizontal run in a gap, before it has a lane. */
type Family = {
	unionId: string;
	unionNodeId: string;
	/** The children's span. */
	left: number;
	right: number;
	/** The whole run at the lane: from the junction to the farthest child. */
	from: number;
	to: number;
	/** The run must stay below its own junction, or the drop would point up. */
	floor: number;
	/** The children's row, which is what a gap is keyed on. */
	top: number;
};

/** Something already in a gap that a lane must not run along: a routed marriage line or a dot. */
type Fixed = { y: number; from: number; to: number; reach: number };

/**
 * Where a DIRECT childless partnership's line runs when somebody stands between the
 * couple, or null when the marriage line at mid-card height is clear.
 *
 * Such a couple has no junction whose placement can pick a clear path, so the canvas
 * routes it a third of a gap under the lower card. Here so that the lanes keep clear
 * of the line the canvas draws, from the same rule.
 */
export function detourY(
	source: PositionedNode,
	target: PositionedNode,
	people: PositionedNode[],
	rowGap: number,
): number | null {
	const midY = (source.position.y + source.height / 2 + target.position.y + target.height / 2) / 2;
	const left = Math.min(source.position.x + source.width / 2, target.position.x + target.width / 2);
	const right = Math.max(
		source.position.x + source.width / 2,
		target.position.x + target.width / 2,
	);
	const crossesCard = people.some(
		(box) =>
			box.id !== source.id &&
			box.id !== target.id &&
			midY >= box.position.y &&
			midY <= box.position.y + box.height &&
			box.position.x < right &&
			box.position.x + box.width > left,
	);
	if (!crossesCard) return null;
	return (
		Math.max(source.position.y + source.height, target.position.y + target.height) + rowGap / 3
	);
}

/** The families, fixed marks and gap boundaries a layout's lanes are chosen from. */
function survey(
	unions: UnionWithChildren[],
	nodes: PositionedNode[],
	edges: FlowEdge[],
	rowGap: number,
) {
	const box = new Map(nodes.map((node) => [node.id, node]));
	const centre = (node: PositionedNode) => node.position.x + node.width / 2;
	const people = nodes.filter((node) => node.type === "person");

	/*
	 * What the lanes must keep off: a couple's marriage line routed through the gap (its
	 * junction sits there, below both partners), a direct partnership's detour, and a
	 * single parent's junction dot that stays in the gap, which a line running through
	 * would seem to join.
	 */
	const fixed: Fixed[] = [];
	const partnersOf = new Map<string, PositionedNode[]>();
	for (const edge of edges) {
		if (!edge.layout || edge.kind !== "partner") continue;
		const source = box.get(edge.source);
		const target = box.get(edge.target);
		if (!source || !target) continue;
		if (target.type === "union") {
			const list = partnersOf.get(target.id);
			if (list) list.push(source);
			else partnersOf.set(target.id, [source]);
		} else {
			const y = detourY(source, target, people, rowGap);
			if (y !== null) {
				fixed.push({
					y,
					from: Math.min(centre(source), centre(target)),
					to: Math.max(centre(source), centre(target)),
					reach: 0,
				});
			}
		}
	}

	const families: Family[] = [];
	for (const union of unions) {
		const dot = box.get(`union:${union.id}`);
		if (!dot) continue;
		const children = union.childIds
			.map((id) => box.get(id))
			.filter((node): node is PositionedNode => Boolean(node));
		const parents = partnersOf.get(dot.id) ?? [];
		const junction = centre(dot);
		// Centre to centre, because that is where a drop line leaves and arrives.
		const centres = children.map(centre);
		// No children, or a lone child straight below the junction: a plain drop, no run.
		if (
			children.length === 0 ||
			(children.length === 1 && Math.abs((centres[0] ?? junction) - junction) < 0.5)
		) {
			if (parents.length === 1) {
				const y = dot.position.y + dot.height / 2;
				fixed.push({ y, from: junction, to: junction, reach: dot.height / 2 + 2 });
			}
			continue;
		}
		families.push({
			unionId: union.id,
			unionNodeId: dot.id,
			left: Math.min(...centres),
			right: Math.max(...centres),
			from: Math.min(junction, ...centres),
			to: Math.max(junction, ...centres),
			// A single parent's dot moves onto the bar once it has a lane (see layout.ts), so
			// only the parent's own card bounds it; any other junction stays where it is.
			floor:
				parents.length === 1
					? Math.max(...parents.map((parent) => parent.position.y + parent.height)) + 2
					: dot.position.y + dot.height + 2,
			top: Math.min(...children.map((child) => child.position.y)),
		});
	}

	for (const [unionNodeId, partners] of partnersOf) {
		const dot = box.get(unionNodeId);
		if (!dot || partners.length < 2) continue;
		const y = dot.position.y + dot.height / 2;
		if (!partners.every((partner) => y > partner.position.y + partner.height)) continue;
		const xs = [centre(dot), ...partners.map(centre)];
		fixed.push({ y, from: Math.min(...xs), to: Math.max(...xs), reach: 0 });
	}

	/** Where the row above a gap ends: the bottom of the nearest cards above the children. */
	const rowAbove = (top: number) => {
		let bottom = Number.NEGATIVE_INFINITY;
		for (const person of people) {
			const end = person.position.y + person.height;
			if (end <= top && end > bottom) bottom = end;
		}
		return bottom;
	};

	/**
	 * Lanes are assigned per GAP, not globally: two families in different
	 * generations can never collide, so making them compete for lanes would push
	 * bars away from their own children for no reason.
	 */
	const gaps = new Map<number, Family[]>();
	for (const family of families) {
		const gap = gaps.get(family.top);
		if (gap) gap.push(family);
		else gaps.set(family.top, [family]);
	}

	return {
		gaps: [...gaps.entries()].map(([top, members]) => {
			const above = rowAbove(top);
			return {
				top,
				above,
				members,
				fixed: fixed.filter((mark) => mark.y > above && mark.y < top),
			};
		}),
		metrics: laneMetrics(rowGap),
	};
}

/**
 * Each lane takes the MOST families that can share it, lane 0 first: earliest-finishing
 * first, the activity-selection rule, which is optimal for one line. Lane 0 is the one
 * that runs exactly through the middle of the gap, so this puts as many families as the
 * picture allows at equal gaps above and below. A family whose junction sits below a
 * lane, or whose run would follow a fixed mark along it, waits for a later lane.
 */
function assign(members: Family[], fixed: Fixed[], middle: number, step: number) {
	const placed: Array<{ family: Family; lane: number }> = [];
	let remaining = [...members].sort((a, b) => a.to - b.to || a.from - b.from);
	for (let lane = 0; remaining.length > 0; lane += 1) {
		const y = middle + stepOf(lane) * step;
		const marks = fixed.filter((mark) => Math.abs(mark.y - y) < step / 2 + mark.reach);
		const rest: Family[] = [];
		let end = Number.NEGATIVE_INFINITY;
		for (const family of remaining) {
			const clear =
				family.floor <= y &&
				// Touching counts as overlapping: two runs meeting end to end read as one.
				family.from > end &&
				!marks.some((mark) => family.from <= mark.to && mark.from <= family.to);
			if (clear) {
				placed.push({ family, lane });
				end = family.to;
			} else {
				rest.push(family);
			}
		}
		remaining = rest;
		// Every lane below the middle is lower than the last, so any floor is reached; this
		// is only a guard against a junction placed under its own children.
		if (lane > 4 * members.length + 8) {
			for (const family of remaining) placed.push({ family, lane });
			break;
		}
	}
	return placed;
}

/** How many steps the farthest lane sits from the middle. */
const reachOf = (placed: Array<{ lane: number }>) =>
	Math.max(0, ...placed.map(({ lane }) => Math.abs(stepOf(lane))));

/**
 * How much taller each generation gap must be for its lanes to keep their clearance.
 *
 * Keyed on the top of the gap's lower row, the row the layout moves down: lane 0 stays
 * in the middle of the grown gap, so a gap needs twice the clearance plus the farthest
 * lane's distance on each side. Most gaps need nothing; on the sample, the generations
 * where the dynasties intermarried hold six families over one x.
 */
export function gapGrowth(
	unions: UnionWithChildren[],
	nodes: PositionedNode[],
	edges: FlowEdge[],
	rowGap: number,
): Map<number, number> {
	const { gaps, metrics } = survey(unions, nodes, edges, rowGap);
	const growth = new Map<number, number>();
	for (const { top, above, members, fixed } of gaps) {
		if (!Number.isFinite(above)) continue;
		const placed = assign(members, fixed, (above + top) / 2, metrics.step);
		const needed = 2 * (metrics.clearance + reachOf(placed) * metrics.step);
		if (needed > top - above) growth.set(top, needed - (top - above));
	}
	return growth;
}

/**
 * One bar per union with a horizontal run on the canvas: two or more children, or one
 * child who is not directly below the junction.
 *
 * @param unions Fused unions, whose `childIds` are fused person ids.
 * @param nodes The laid-out graph, for the positions the bar spans.
 * @param edges The family edges, for the marriage lines a lane must keep off.
 * @param rowGap The level's generation gap, which the lane geometry scales with.
 */
export function siblingBars(
	unions: UnionWithChildren[],
	nodes: PositionedNode[],
	edges: FlowEdge[],
	rowGap: number,
): Map<string, SiblingBar> {
	const { gaps, metrics } = survey(unions, nodes, edges, rowGap);
	const bars = new Map<string, SiblingBar>();

	for (const { top, above, members, fixed } of gaps) {
		/*
		 * Measured from the ROWS, not from the union down. The union dot's own y varies with
		 * how its partners were placed, while the two rows are uniform -- so every bar in a
		 * generation keeps the same rhythm, which is what makes lane 0 read as one line.
		 * With no row above, there is nothing to centre against, and the lanes start a
		 * clearance above the children.
		 */
		const hasRow = Number.isFinite(above);
		const middle = hasRow ? (above + top) / 2 : top - metrics.clearance;
		const placed = assign(members, fixed, middle, metrics.step);

		/*
		 * The layout grows a gap to fit its lanes, so this fits by construction. A gap it did
		 * not grow (an arrangement that skipped the pass) packs its lanes closer instead,
		 * the outermost a fifth of the gap clear of both rows, never under `MIN_DROP`.
		 */
		const steps = reachOf(placed);
		let spacing = metrics.step;
		if (hasRow && steps > 0) {
			const half = (top - above) / 2;
			const room = half - steps * metrics.step;
			const floor = Math.max(MIN_DROP, (top - above) * 0.2);
			if (room < floor) spacing = Math.max(0, half - floor) / steps;
		}

		for (const { family, lane } of placed) {
			const y = middle + stepOf(lane) * spacing;
			bars.set(family.unionNodeId, {
				unionId: family.unionId,
				unionNodeId: family.unionNodeId,
				// Never above the parents: a bar that overshoots its own union dot points the
				// drop line upwards, which reads as the children being the ancestors. Never so
				// low that a drop has no length to turn its corner in.
				y: Math.min(Math.max(y, family.floor), top - MIN_DROP),
				left: family.left,
				right: family.right,
				lane,
			});
		}
	}

	return bars;
}
