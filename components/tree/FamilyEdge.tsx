"use client";

/**
 * The family skeleton's edge.
 *
 * Rebuilt from scratch: the previous version hand-built its sibling-bar route out of `L`
 * commands, so 82 of the 150 edges on the sample canvas turned through hard 90 degree
 * corners while the rounded-corner constant sat unused in the fallback branch. All the
 * geometry now lives in lib/tree/paths.ts, where it is unit-testable -- a corner that
 * inverts or a bracket that overshoots is arithmetic, not an appearance.
 *
 * Three routes, and the choice is the interesting part:
 *
 *   1. A rounded elbow through the family's shared bar. The default, and what a pedigree
 *      is conventionally drawn as.
 *   2. A vertical-tangent curve, when the family is too wide for a bracket to read. The
 *      sample tree had one bar running 6013px against a 200px median: a horizontal line
 *      crossing the whole canvas is a rule, not a bracket, and no amount of corner
 *      rounding fixes that.
 *   3. A rounded elbow with no bar at all, for partner edges and single children.
 *
 * `pathLength={1}` on every path is load-bearing. It normalises each path's length so ONE
 * dasharray in globals.css drives the draw-on for every edge in the tree; without it a
 * short partner edge finishes drawing while a long cross-generation one is a third done.
 */
import { BaseEdge, type EdgeProps, getSmoothStepPath, type Position } from "@xyflow/react";
import {
	bracketPath,
	CORNER,
	curvePath,
	elbowPath,
	MAX_BAR_SPAN,
	orbitPath,
} from "@/lib/tree/paths";

/** Set on child edges whose union has a sibling bar. See lib/tree/siblings.ts. */
export type FamilyEdgeData = {
	/** The y the shared horizontal bar runs at. */
	barY: number;
	/** Bar extent, so only ONE edge per family draws it. */
	barLeft: number;
	barRight: number;
	/** True for the single edge elected to draw the horizontal run. */
	drawsBar: boolean;
};

/**
 * The junction an edge meets, in flow coordinates.
 *
 * React Flow anchors an edge to a HANDLE, and it offsets handles outward from the node box.
 * On a 12x12 union that leaves a hole: measured on the sample canvas, partner edges ended at
 * y=173 and child edges began at y=191, with the dot's centre at 182 -- an 18px dead zone
 * with a 12px dot floating in the middle of it, which is the broken line in the screenshot.
 *
 * So the union's own centre travels with the edge and both sides terminate there. Nothing
 * else can fix it from inside the edge: `sourceY`/`targetY` are already the handle positions
 * by the time this component runs.
 */
export type JunctionAnchor = {
	/** Centre of the union dot the SOURCE end sits on, when the source is a junction. */
	sourceHub?: { x: number; y: number };
	/** Centre of the union dot the TARGET end sits on, when the target is a junction. */
	targetHub?: { x: number; y: number };
};

/**
 * Set on every edge when the canvas is arranged as an orbit.
 *
 * The arrangement has to reach the edge because a pedigree's router is actively wrong on
 * rings: reusing it produced a median edge of 2423px with 94 of 150 over 2000px, each a
 * straight chord through the middle of the graph. There is no sibling bar in an orbit, so
 * without this flag every edge silently falls through to the orthogonal fallback.
 */
export type OrbitEdgeData = {
	orbit: true;
};

export function FamilyEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	markerEnd,
	style,
	data,
}: EdgeProps) {
	const bar = data as (FamilyEdgeData & Partial<OrbitEdgeData> & JunctionAnchor) | undefined;

	/*
	 * Snap each end that meets a junction onto the dot's CENTRE.
	 *
	 * This is what closes the 18px hole: a partner edge now runs into the middle of the dot
	 * rather than stopping 9px short of it, and a child edge leaves from the same point rather
	 * than starting 9px below. Both ends land on one pixel, so the couple, the dot and the
	 * drop read as a single continuous mark.
	 */
	const sx = bar?.sourceHub?.x ?? sourceX;
	const sy = bar?.sourceHub?.y ?? sourceY;
	const tx = bar?.targetHub?.x ?? targetX;
	const ty = bar?.targetHub?.y ?? targetY;

	/*
	 * Orbit first, because it overrides everything below.
	 *
	 * A ring layout has no generations to bracket and no "down", so neither the elbow nor the
	 * orthogonal fallback means anything here. `orbitPath` bows each edge outward along its
	 * own radius so it stays in the annulus between two rings rather than cutting across the
	 * middle -- which is what made the first orbit render a web of chords.
	 */
	if (bar?.orbit) {
		const path = orbitPath(sx, sy, tx, ty);
		return (
			<>
				<BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} pathLength={1} />
				<Pulse path={path} />
			</>
		);
	}

	/*
	 * The bar branch requires a bar, and testing `data` for truthiness is not the same thing.
	 *
	 * Every edge now carries `data` for the junction anchor, so a partner edge -- which has no
	 * sibling bar -- fell into the elbow branch and read `bar.barY` as undefined. The result was
	 * a path of literal NaNs ("L NaN NaN Q ... undefined") whose `getTotalLength()` is 0, so the
	 * couple's line vanished entirely. Check the FIELD that the branch actually needs.
	 */
	if (bar && typeof bar.barY === "number") {
		const span = bar.barRight - bar.barLeft;

		/*
		 * A family too wide to bracket is drawn as curves instead.
		 *
		 * Each child gets its own line from the union dot, so the shape still says "these
		 * came from here" -- but by convergence at the parent rather than by a shared
		 * horizontal, which at this width the eye cannot take in as one mark. The curve keeps
		 * vertical tangents so it still leaves the parent downward and arrives at the child
		 * from above, which is the direction cue the orthogonal route gets from its geometry.
		 */
		if (span > MAX_BAR_SPAN) {
			const path = curvePath(sx, sy, tx, ty);
			return (
				<>
					<BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} pathLength={1} />
					<Pulse path={path} />
				</>
			);
		}

		/*
		 * The bracket is drawn by exactly ONE elected edge per family, and the drop lines by
		 * all of them.
		 *
		 * Every child drawing the full run would stack N identical strokes -- brightest where
		 * they pile up, and each animating its own draw-on, so the bar would appear N times
		 * over. The election is by lowest edge id in TreeCanvas, which is stable across
		 * relayouts in a way "the leftmost child" is not.
		 */
		const stem = elbowPath(sx, sy, tx, ty, bar.barY);
		const bracket = bar.drawsBar
			? ` ${bracketPath(bar.barLeft, bar.barRight, bar.barY, CORNER)}`
			: "";
		const path = `${stem}${bracket}`;

		return (
			<>
				<BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} pathLength={1} />
				<Pulse path={path} />
			</>
		);
	}

	/*
	 * No bar: a partner edge, or a union with a single child.
	 *
	 * React Flow's own smoothstep, because with no shared bar to route through there is
	 * nothing our elbow would do differently -- and their generator already handles the
	 * handle-position cases (a partner edge leaves a card's side, not its bottom).
	 */
	const [path] = getSmoothStepPath({
		sourceX: sx,
		sourceY: sy,
		targetX: tx,
		targetY: ty,
		sourcePosition: sourcePosition as Position,
		targetPosition: targetPosition as Position,
		borderRadius: CORNER,
	});

	return (
		<>
			<BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} pathLength={1} />
			<Pulse path={path} />
		</>
	);
}

/**
 * A short bright segment that travels along the edge while the edge is lit.
 *
 * Hovering a person already lights their family path, but a lit path only says WHICH
 * lines -- it does not say which way the lineage runs, and on an orthogonal skeleton with
 * a shared bracket that is genuinely ambiguous. A segment travelling source -> target
 * answers it along the whole line, the same argument that replaced the arrowhead with a
 * taper on relation edges.
 *
 * A second path rather than a dash on the existing one, because the base path is already
 * carrying the draw-on plus whatever the cascade says about weight and colour. Layering
 * keeps the pulse out of an override war with any of that, and the line stays solid
 * underneath instead of becoming a dashed line while a dash travels through it.
 *
 * Always rendered, never conditional on focus: this sits under the layout effect, so a
 * prop that changed on hover would put focus state into the memo ELK depends on -- the
 * exact trap the split edge arrays exist to avoid. An idle pulse is `stroke: none`, which
 * costs a DOM node and no paint, and CSS switches it on from the ancestor's `.is-active`.
 */
function Pulse({ path }: { path: string }) {
	// No aria-hidden, deliberately. Biome's noAriaHiddenOnFocusable fires on a hidden SVG
	// node here, and the honest resolution is that the attribute was never needed: a bare
	// <path> carries no role and no accessible name, so there is nothing in the
	// accessibility tree to hide. The edge's name comes from the `ariaLabel` React Flow
	// puts on the group, and `edgesFocusable={false}` keeps the subtree out of the tab
	// order. Pointer events are off in CSS, so the skeleton cannot swallow the pan drag.
	return <path className="kf-pulse" d={path} pathLength={1} fill="none" />;
}
