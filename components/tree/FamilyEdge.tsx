"use client";

/**
 * The family skeleton's edge.
 *
 * A custom type for one reason: `pathLength={1}`. It normalises the SVG path's
 * length so the draw-on keyframes in globals.css work with a single dasharray
 * whatever the edge's real geometry. Without it, every edge needs a dasharray
 * matching its own length, and short partner edges finish drawing while long
 * cross-generation ones are still a third of the way down.
 *
 * React Flow's built-in `smoothstep` type gives no way to set an SVG attribute on
 * the path, so this wraps the same path generator it uses. Behaviour is otherwise
 * identical -- this is not a different route, just a labelled one.
 */
import { BaseEdge, type EdgeProps, getSmoothStepPath, type Position } from "@xyflow/react";

/** Matches the corner radius on a card, so a join reads as part of the same set. */
const CORNER_RADIUS = 8;

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
	const bar = data as FamilyEdgeData | undefined;

	if (bar) {
		/**
		 * Union -> bar -> child, drawn explicitly rather than left to the router.
		 *
		 * Smoothstep already routed every child of one union through a shared y, so
		 * the bar was visible without this. What it could not do is keep two families
		 * in one generation off the same line: measured on the sample tree, 16 unions
		 * shared the y at 919 and two pairs at y=451 had overlapping spans, which
		 * makes one bar serve two sets of parents and a reader cannot tell whose child
		 * is whose. `siblingBars()` assigns each family a lane; this draws it there.
		 *
		 * The horizontal run is drawn by exactly ONE edge of the family. Every child
		 * drawing the full bar would stack N copies of the same line, and each of them
		 * animates its own draw-on -- so the bar would appear N times over, brightest
		 * where the strokes pile up.
		 */
		const stem = `M ${sourceX} ${sourceY} L ${sourceX} ${bar.barY}`;
		const run = bar.drawsBar ? ` M ${bar.barLeft} ${bar.barY} L ${bar.barRight} ${bar.barY}` : "";
		const drop = ` M ${targetX} ${bar.barY} L ${targetX} ${targetY}`;

		return (
			<>
				<BaseEdge
					id={id}
					path={`${stem}${run}${drop}`}
					markerEnd={markerEnd}
					style={style}
					pathLength={1}
				/>
				<Pulse path={`${stem}${run}${drop}`} />
			</>
		);
	}

	const [path] = getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition: sourcePosition as Position,
		targetPosition: targetPosition as Position,
		borderRadius: CORNER_RADIUS,
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
 * The one piece of motion the canvas has at rest is the entrance; this is the one it has
 * on demand. Hovering a person already lights their family path, but a lit path only
 * says WHICH lines -- it does not say which way the lineage runs, and on an orthogonal
 * skeleton with a shared sibling bar that is genuinely ambiguous. A segment travelling
 * source -> target answers it along the whole line, which is the same argument that
 * replaced the arrowhead with a taper on relation edges.
 *
 * A second path rather than a dash on the existing one, because the base path is
 * carrying the draw-on animation plus whatever the cascade says about weight and colour.
 * Layering keeps the pulse from having to win an override war with any of that, and it
 * means the line stays solid underneath instead of turning into a dashed line while a
 * dash travels through it.
 *
 * Always rendered, never conditional on focus: this component sits under the layout
 * effect, so a prop that changed on hover would put focus state back into the memo ELK
 * depends on -- the exact trap the split edge arrays exist to avoid. An idle pulse is a
 * `stroke: none` path, which costs a node and no paint, and CSS turns it on from the
 * ancestor's `.is-active` class instead.
 *
 * `pathLength={1}` on both paths is what makes ONE dasharray work for every edge in the
 * tree, whatever its real geometry -- the same normalisation the draw-on needs.
 */
function Pulse({ path }: { path: string }) {
	// No aria-hidden, and that is deliberate rather than an oversight. Biome's
	// noAriaHiddenOnFocusable fires on any hidden SVG node here, and the honest resolution
	// is that the attribute was never needed: a bare <path> carries no role and no
	// accessible name, so it contributes nothing to the accessibility tree to hide. The
	// edge's own name comes from the `ariaLabel` React Flow puts on the group, and
	// `edgesFocusable={false}` on the canvas keeps the whole subtree out of the tab order.
	// Suppressing the rule would have asserted the opposite of what is true here.
	// Pointer events are off in CSS, so the skeleton cannot swallow the drag that pans.
	return <path className="kf-pulse" d={path} pathLength={1} fill="none" />;
}
