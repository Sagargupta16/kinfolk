/**
 * The tree reduced to coloured boxes, and the maths that fits it into a panel.
 *
 * Separate from the canvas nodes on purpose. Hover focus rewrites every node's
 * className through `setNodes`, so a map reading the live node array would rebuild
 * 151 rectangles on every mouse move -- for an answer that cannot have changed,
 * since an overview shows where people ARE and hovering moves nobody. Derived from
 * the layout instead, so it is rebuilt exactly when positions change.
 *
 * The projection lives here rather than in the component for the reason every other
 * graph calculation does: it is arithmetic with an answer that can be asserted, and
 * the two bugs it has already had (a frame that moved with the zoom, a viewport
 * rectangle larger than the panel holding it) were both invisible in the file and
 * obvious in a number.
 *
 * Tones are named rather than coloured: this file knows what a person IS, and the map
 * decides what that looks like. Keeps the palette next to the tokens instead of
 * forking hex values into a data transform.
 */
import type { FusedPerson } from "./graph";
import type { Box, PositionedNode } from "./layout";

/**
 * Why these five and not the card's full vocabulary.
 *
 * A person is ~4px wide here, which is room for one fact. The card can afford
 * provenance ticks and a closeness ring; the map gets the single distinction that
 * makes a shape navigable -- who you are, and who is still here.
 *
 *   self     -- the viewer, the one landmark on a canvas 10760px wide
 *   living   -- an explicit "living"
 *   past     -- an explicit "deceased"
 *   unsure   -- "unknown", which is a stored value and not a missing one
 *   junction -- a union dot: drawn, because a gap between two partners reads as a
 *               missing person at this scale
 */
export type OverviewTone = "self" | "living" | "past" | "unsure" | "junction";

export type OverviewNode = {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	tone: OverviewTone;
};

/**
 * Panel width, and the range its height may occupy.
 *
 * The width is fixed because the panel sits in a corner and its footprint should not
 * jump when the detail level changes. Height is what adapts.
 *
 * The floor is 40px: a wide tree projects to a strip, and below that the viewport
 * rectangle is a couple of pixels tall and can no longer be aimed. The ceiling is
 * 132px because past that the overview starts competing for the corner with the canvas
 * it is drawn over.
 */
export const OVERVIEW_WIDTH = 200;
export const OVERVIEW_MIN_HEIGHT = 40;
export const OVERVIEW_MAX_HEIGHT = 132;

/**
 * Breathing room inside the frame, in panel pixels.
 *
 * Small and CONSTANT, unlike React Flow's `offsetScale`, which is 5 graph units
 * multiplied by the projection scale -- on this tree that worked out to 10 of the 44
 * available pixels, a quarter of the panel spent on padding at the level where space
 * was tightest.
 */
const PAD = 3;

/**
 * Smallest viewport rectangle worth drawing, in panel pixels.
 *
 * Once the rectangle is clamped to the frame it can collapse: pan past the last cousin
 * and the true rectangle is entirely outside the tree. A sliver pinned to the edge
 * still says which way home is, where a rectangle of zero width says the overview is
 * broken.
 */
const MIN_RECT = 3;

/**
 * Flatten laid-out nodes into the map's own shape.
 *
 * `selfId` is matched against the fused person's SOURCES, not its id: after fusion
 * the viewer's own row is one contributor to a merged person whose id is the smallest
 * member's, which is frequently somebody else's row.
 */
export function overviewNodes(nodes: PositionedNode[], selfId?: string): OverviewNode[] {
	return nodes.map((node) => ({
		id: node.id,
		x: node.position.x,
		y: node.position.y,
		width: node.width,
		height: node.height,
		tone: toneOf(node, selfId),
	}));
}

function toneOf(node: PositionedNode, selfId?: string): OverviewTone {
	if (node.type !== "person") return "junction";

	const person = node.data as FusedPerson;
	// The viewer wins over their own living status. They are the landmark, and a
	// living relative beside them in the same green would hide it.
	if (selfId && person.sources.some((source) => source.id === selfId)) return "self";

	switch (person.primary.living) {
		case "deceased":
			return "past";
		case "unknown":
			return "unsure";
		default:
			return "living";
	}
}

/**
 * Fit the panel to the graph's own aspect ratio, within the range above.
 *
 * Measured on the sample tree: 10760x1137 as cards gives 21px, clamped to 40; as rows
 * 8704x712 gives 16px, also clamped; as dots 1512x488 gives 65px, used as is. So the
 * clamp is doing real work at two of the three levels rather than being defensive
 * decoration.
 */
export function overviewHeight(extent: Box): number {
	if (extent.width <= 0 || extent.height <= 0) return OVERVIEW_MIN_HEIGHT;
	const scaled = (OVERVIEW_WIDTH * extent.height) / extent.width;
	return Math.round(Math.min(Math.max(scaled, OVERVIEW_MIN_HEIGHT), OVERVIEW_MAX_HEIGHT));
}

export type OverviewProjection = {
	/** Panel pixels per graph unit. */
	scale: number;
	offsetX: number;
	offsetY: number;
};

/**
 * Graph units to panel pixels, against a frame that never moves.
 *
 * ONE scale for both axes, so the family keeps its proportions: a tree stretched to
 * fill a box is a different shape, and shape is the entire payload here. The axis that
 * does not dominate gets centred instead.
 *
 * The frame is the graph extent and nothing else, which is the whole reason this is not
 * React Flow's `<MiniMap>`. Theirs projects
 * `getBoundsOfRects(nodeBounds, currentViewport)`, so zooming out grows the frame and
 * shrinks the tree inside it -- measured at 42% of the width and 17% of the height at
 * the zoom this canvas opens at, drifting as the viewer zoomed. An overview whose frame
 * moves is not a reference point.
 */
export function overviewProjection(extent: Box, height: number): OverviewProjection {
	const innerWidth = OVERVIEW_WIDTH - PAD * 2;
	const innerHeight = height - PAD * 2;
	if (extent.width <= 0 || extent.height <= 0 || innerWidth <= 0 || innerHeight <= 0) {
		return { scale: 0, offsetX: PAD, offsetY: PAD };
	}

	const scale = Math.min(innerWidth / extent.width, innerHeight / extent.height);
	return {
		scale,
		offsetX: PAD + (innerWidth - extent.width * scale) / 2,
		offsetY: PAD + (innerHeight - extent.height * scale) / 2,
	};
}

/**
 * The viewer's window on the tree, in panel pixels, clamped to the frame.
 *
 * Clamped rather than clipped, and that is the difference between a working overview
 * and a broken-looking one. At dot detail the whole tree fits on screen, so the true
 * rectangle is 219x329 inside a 200x65 panel: clipping it draws the parts that fall
 * outside nowhere at all, leaving an empty frame at exactly the moment the honest
 * answer is "all of it". Clamping pins the rectangle to the frame edges, which reads as
 * that.
 *
 * @param transform React Flow's `[x, y, zoom]`, in screen pixels.
 * @param flow The canvas viewport size, in screen pixels.
 */
export function overviewViewport(
	extent: Box,
	height: number,
	transform: readonly [number, number, number],
	flow: { width: number; height: number },
): Box | null {
	const [tx, ty, zoom] = transform;
	if (zoom <= 0 || flow.width <= 0 || flow.height <= 0) return null;

	const { scale, offsetX, offsetY } = overviewProjection(extent, height);
	if (scale <= 0) return null;

	// Screen rect to graph coordinates, then graph to panel.
	const left = offsetX + (-tx / zoom - extent.x) * scale;
	const top = offsetY + (-ty / zoom - extent.y) * scale;
	const right = left + (flow.width / zoom) * scale;
	const bottom = top + (flow.height / zoom) * scale;

	const clampedLeft = clamp(left, 0, OVERVIEW_WIDTH - MIN_RECT);
	const clampedTop = clamp(top, 0, height - MIN_RECT);
	const clampedRight = clamp(right, clampedLeft + MIN_RECT, OVERVIEW_WIDTH);
	const clampedBottom = clamp(bottom, clampedTop + MIN_RECT, height);

	return {
		x: clampedLeft,
		y: clampedTop,
		width: clampedRight - clampedLeft,
		height: clampedBottom - clampedTop,
	};
}

/**
 * A point in the panel back to a point in the graph, for click-to-travel.
 *
 * The inverse of `overviewProjection`, so aiming and drawing can never disagree about
 * where a pixel is.
 */
export function overviewPoint(
	extent: Box,
	height: number,
	panelX: number,
	panelY: number,
): { x: number; y: number } | null {
	const { scale, offsetX, offsetY } = overviewProjection(extent, height);
	if (scale <= 0) return null;

	return {
		x: extent.x + (panelX - offsetX) / scale,
		y: extent.y + (panelY - offsetY) / scale,
	};
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
