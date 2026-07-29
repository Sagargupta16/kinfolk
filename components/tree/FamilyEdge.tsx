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
}: EdgeProps) {
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
