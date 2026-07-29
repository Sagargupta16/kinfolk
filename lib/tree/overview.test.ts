/**
 * The overview reduces a person to one fact, so the tests are about which fact wins.
 */
import { describe, expect, it } from "vitest";
import type { FlowNode, FusedPerson } from "./graph";
import type { Box, PositionedNode } from "./layout";
import {
	OVERVIEW_MAX_HEIGHT,
	OVERVIEW_MIN_HEIGHT,
	OVERVIEW_WIDTH,
	overviewHeight,
	overviewNodes,
	overviewPoint,
	overviewProjection,
	overviewViewport,
} from "./overview";

function person(
	id: string,
	living: "living" | "deceased" | "unknown",
	sourceIds: string[] = [id],
): PositionedNode {
	const fused = {
		id,
		primary: { id, givenName: id, living } as FusedPerson["primary"],
		sources: sourceIds.map((sourceId) => ({ id: sourceId })),
		contributingTreeIds: [],
		contacts: [],
	} as unknown as FusedPerson;

	return {
		id,
		type: "person",
		data: fused,
		position: { x: 0, y: 0 },
		width: 200,
		height: 92,
	} as PositionedNode;
}

function union(id: string): PositionedNode {
	return {
		id,
		type: "union",
		data: { union: { id, childIds: [] } },
		position: { x: 0, y: 0 },
		width: 12,
		height: 12,
	} as unknown as FlowNode as PositionedNode;
}

describe("overviewNodes", () => {
	it("maps each living status to its own tone", () => {
		const tones = overviewNodes([
			person("a", "living"),
			person("b", "deceased"),
			person("c", "unknown"),
		]).map((node) => node.tone);

		expect(tones).toEqual(["living", "past", "unsure"]);
	});

	it("draws union dots rather than dropping them", () => {
		// A 12px junction between two partners. Skipped, it would read as a gap -- and
		// at this scale a gap looks like a missing person.
		expect(overviewNodes([union("u1")]).map((n) => n.tone)).toEqual(["junction"]);
	});

	it("matches the viewer through fusion, not by node id", () => {
		// After fusion the id is the smallest member's, which is frequently somebody
		// else's row. Comparing ids would lose the viewer on every merged person -- the
		// exact people most worth locating.
		const merged = person("aunt-row", "living", ["aunt-row", "my-row"]);
		expect(overviewNodes([merged], "my-row")[0]?.tone).toBe("self");
	});

	it("puts the viewer above their own living status", () => {
		const self = person("me", "living");
		expect(overviewNodes([self], "me")[0]?.tone).toBe("self");
		// And with no viewer, the same person is just another living relative.
		expect(overviewNodes([self])[0]?.tone).toBe("living");
	});

	it("carries position and size straight through", () => {
		const placed = { ...person("a", "living"), position: { x: 40, y: 180 } };
		expect(overviewNodes([placed])[0]).toEqual({
			id: "a",
			x: 40,
			y: 180,
			width: 200,
			height: 92,
			tone: "living",
		});
	});
});

/** The sample tree as cards: the shape every measurement in these comments came from. */
const WIDE: Box = { x: 0, y: 0, width: 10760, height: 1137 };
/** And as dots, where the whole tree fits on screen at once. */
const SQUARISH: Box = { x: 0, y: 0, width: 1512, height: 488 };

describe("overviewHeight", () => {
	it("clamps a wide tree up to the floor", () => {
		// 200 * 1137 / 10760 = 21px, which is too short to aim a viewport rectangle in.
		expect(overviewHeight(WIDE)).toBe(OVERVIEW_MIN_HEIGHT);
	});

	it("uses the graph's own ratio when it lands in range", () => {
		// 200 * 488 / 1512 = 65. Untouched, so the dot view is drawn at true proportions.
		expect(overviewHeight(SQUARISH)).toBe(65);
	});

	it("clamps a tall tree down to the ceiling", () => {
		expect(overviewHeight({ x: 0, y: 0, width: 100, height: 9000 })).toBe(OVERVIEW_MAX_HEIGHT);
	});

	it("survives an empty tree, which is what a new account opens in", () => {
		// The alternative is a division by zero reaching an svg height attribute.
		expect(overviewHeight({ x: 0, y: 0, width: 0, height: 0 })).toBe(OVERVIEW_MIN_HEIGHT);
	});
});

describe("overviewProjection", () => {
	it("uses one scale for both axes so the family keeps its shape", () => {
		// Whichever axis runs out first sets the scale for both. Rounding the panel height
		// to a whole pixel is what decides which: the dot view's 194x59 inner box is
		// proportionally wider than the 1512x488 graph, so HEIGHT is the binding
		// constraint even though the tree is the wider shape.
		expect(overviewProjection(SQUARISH, 65).scale).toBeCloseTo(59 / 488, 6);
		// And a genuinely wide tree in a clamped panel binds on the width.
		expect(overviewProjection(WIDE, OVERVIEW_MIN_HEIGHT).scale).toBeCloseTo(
			(OVERVIEW_WIDTH - 6) / 10760,
			6,
		);
	});

	it("centres the axis that does not dominate", () => {
		// A wide tree in a clamped-taller panel gets equal space above and below rather
		// than being stretched to fill it.
		const { offsetY } = overviewProjection(WIDE, OVERVIEW_MIN_HEIGHT);
		const { scale } = overviewProjection(WIDE, OVERVIEW_MIN_HEIGHT);
		const drawn = 1137 * scale;
		expect(offsetY).toBeCloseTo(3 + (OVERVIEW_MIN_HEIGHT - 6 - drawn) / 2, 6);
	});

	it("reports a zero scale for an empty tree rather than Infinity", () => {
		expect(overviewProjection({ x: 0, y: 0, width: 0, height: 0 }, 40).scale).toBe(0);
	});

	it("round-trips a panel point back to the graph", () => {
		// Aiming and drawing must never disagree about where a pixel is.
		const height = overviewHeight(WIDE);
		const { scale, offsetX, offsetY } = overviewProjection(WIDE, height);
		const panelX = offsetX + (4200 - WIDE.x) * scale;
		const panelY = offsetY + (700 - WIDE.y) * scale;

		const point = overviewPoint(WIDE, height, panelX, panelY);
		expect(point?.x).toBeCloseTo(4200, 4);
		expect(point?.y).toBeCloseTo(700, 4);
	});
});

describe("overviewViewport", () => {
	/** React Flow's transform for a viewport showing `graph` at `zoom`. */
	function transformFor(x: number, y: number, zoom: number): [number, number, number] {
		return [-x * zoom, -y * zoom, zoom];
	}

	it("marks the part of the tree that is on screen", () => {
		const height = overviewHeight(WIDE);
		const { scale, offsetX } = overviewProjection(WIDE, height);
		// A 1440px window at 1x, parked 2000 units in.
		const rect = overviewViewport(WIDE, height, transformFor(2000, 0, 1), {
			width: 1440,
			height: 800,
		});

		expect(rect?.x).toBeCloseTo(offsetX + 2000 * scale, 4);
		expect(rect?.width).toBeCloseTo(1440 * scale, 4);
	});

	it("clamps to the frame instead of overflowing it", () => {
		// The bug this exists for. At dot detail the whole tree fits on screen, so the
		// true rectangle measured 219x329 inside a 200x65 panel: clipping drew the
		// overflow nowhere and left an EMPTY frame at exactly the moment the honest
		// answer is "all of it". Clamped, the rectangle fills the frame and says so.
		const height = overviewHeight(SQUARISH);
		const rect = overviewViewport(SQUARISH, height, transformFor(-400, -300, 0.5), {
			width: 1440,
			height: 800,
		});

		expect(rect?.x).toBe(0);
		expect(rect?.y).toBe(0);
		expect(rect?.width).toBe(OVERVIEW_WIDTH);
		expect(rect?.height).toBe(height);
	});

	it("keeps a visible sliver when the viewer pans off the tree entirely", () => {
		// Panned past the last cousin: the true rectangle is wholly outside the extent.
		// A sliver on the edge still says which way home is; a zero-width rect reads as
		// a broken overview.
		const height = overviewHeight(WIDE);
		const rect = overviewViewport(WIDE, height, transformFor(90000, 0, 1), {
			width: 1440,
			height: 800,
		});

		expect(rect).not.toBeNull();
		expect((rect?.width ?? 0) >= 3).toBe(true);
		expect((rect?.height ?? 0) >= 3).toBe(true);
		expect((rect?.x ?? 0) <= OVERVIEW_WIDTH).toBe(true);
	});

	it("returns nothing before the canvas has been measured", () => {
		// zoom 0 is React Flow's pre-measurement state, and dividing by it would put NaN
		// in an svg attribute -- which throws rather than rendering nothing.
		const height = overviewHeight(WIDE);
		expect(overviewViewport(WIDE, height, [0, 0, 0], { width: 1440, height: 800 })).toBeNull();
		expect(overviewViewport(WIDE, height, [0, 0, 1], { width: 0, height: 0 })).toBeNull();
	});
});
