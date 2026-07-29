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
			<BaseEdge
				id={id}
				path={`${stem}${run}${drop}`}
				markerEnd={markerEnd}
				style={style}
				pathLength={1}
			/>
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

	return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} pathLength={1} />;
}
