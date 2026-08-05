/**
 * Connector geometry. Every assertion here is about a path a reader will believe
 * without checking, and both defects this file guards against were live on the canvas:
 * hard 90 degree corners on 82 of 150 edges, and a bracket clamp that did not exist.
 */
import { describe, expect, it } from "vitest";
import { bracketPath, CORNER, curvePath, elbowPath, MAX_BAR_SPAN } from "./paths";

/** Every coordinate pair in a path string, in order. */
function points(path: string): Array<[number, number]> {
	const nums = path.match(/-?[\d.]+/g)?.map(Number) ?? [];
	const pairs: Array<[number, number]> = [];
	for (let i = 0; i + 1 < nums.length; i += 2)
		pairs.push([nums[i] as number, nums[i + 1] as number]);
	return pairs;
}

describe("elbowPath", () => {
	it("rounds both turns instead of cornering", () => {
		const path = elbowPath(100, 0, 500, 300, 150);
		// Two quadratics, one per turn. The old hand-built version emitted only `L`
		// commands, which is exactly the hard-corner defect measured on 82 of 150 edges.
		expect(path.match(/Q/g)).toHaveLength(2);
	});

	it("routes through the bar and lands on the target", () => {
		const path = elbowPath(100, 0, 500, 300, 150);
		const pts = points(path);
		expect(pts[0]).toEqual([100, 0]);
		expect(pts[pts.length - 1]).toEqual([500, 300]);
		// Never strays outside the box the route defines.
		for (const [x, y] of pts) {
			expect(x).toBeGreaterThanOrEqual(100 - 0.01);
			expect(x).toBeLessThanOrEqual(500 + 0.01);
			expect(y).toBeGreaterThanOrEqual(0 - 0.01);
			expect(y).toBeLessThanOrEqual(300 + 0.01);
		}
	});

	it("turns the right way when the child is to the LEFT", () => {
		// The mirrored case, which a sign table gets wrong and unit vectors get right.
		const path = elbowPath(500, 0, 100, 300, 150);
		const pts = points(path);
		expect(pts[0]).toEqual([500, 0]);
		expect(pts[pts.length - 1]).toEqual([100, 300]);
		for (const [x] of pts) {
			expect(x).toBeGreaterThanOrEqual(100 - 0.01);
			expect(x).toBeLessThanOrEqual(500 + 0.01);
		}
	});

	it("clamps the radius when there is barely any horizontal run", () => {
		// dx = 8 against a radius of 10: unclamped, each turn would consume more than the
		// whole leg and the path would bulge back past where it started.
		const path = elbowPath(100, 0, 108, 300, 150);
		for (const [x] of points(path)) {
			expect(x).toBeGreaterThanOrEqual(100 - 0.01);
			expect(x).toBeLessThanOrEqual(108 + 0.01);
		}
	});

	it("draws a plain drop when the child is directly below", () => {
		// A quadratic whose control point coincides with its endpoints renders as a
		// degenerate wobble, so this case must not produce one.
		const path = elbowPath(100, 0, 100, 300, 150);
		expect(path).not.toContain("Q");
		expect(points(path)).toEqual([
			[100, 0],
			[100, 300],
		]);
	});

	it("keeps the corner radius no larger than the constant asks", () => {
		// The turn begins at most CORNER before the corner, so with 200px of run the
		// horizontal leg is still visible between the two curves.
		const path = elbowPath(0, 0, 200, 100, 50);
		const pts = points(path);
		const firstTurnStart = pts[1] as [number, number];
		expect(50 - firstTurnStart[1]).toBeLessThanOrEqual(CORNER + 0.01);
	});
});

describe("curvePath", () => {
	it("leaves and arrives with VERTICAL tangents", () => {
		// The direction cue: a curve that left sideways would read as a sibling link
		// rather than as descent.
		const path = curvePath(100, 0, 500, 300);
		const [start, c1, c2, end] = points(path);
		expect(c1?.[0]).toBe(start?.[0]);
		expect(c2?.[0]).toBe(end?.[0]);
	});

	it("extends the control points by the tension fraction", () => {
		const [, c1, c2] = points(curvePath(0, 0, 100, 200, 0.5));
		expect(c1?.[1]).toBeCloseTo(100, 5);
		expect(c2?.[1]).toBeCloseTo(100, 5);
	});

	it("degenerates to a straight line at zero tension", () => {
		const [start, c1, c2, end] = points(curvePath(0, 0, 100, 200, 0));
		expect(c1?.[1]).toBe(start?.[1]);
		expect(c2?.[1]).toBe(end?.[1]);
	});
});

describe("bracketPath", () => {
	it("turns both ends downward so it reads as a bracket, not a rule", () => {
		const path = bracketPath(100, 500, 200);
		expect(path.match(/Q/g)).toHaveLength(2);
		const pts = points(path);
		// Both ends sit BELOW the bar: that is what closes the shape.
		expect(pts[0]?.[1]).toBeGreaterThan(200);
		expect(pts[pts.length - 1]?.[1]).toBeGreaterThan(200);
	});

	it("spans exactly the requested extent", () => {
		const pts = points(bracketPath(100, 500, 200));
		expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(100, 5);
		expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(500, 5);
	});

	it("falls back to a plain run when too tight to turn", () => {
		// Two rounded caps need 2r of span between them; below that they would overlap
		// into a shape that is neither a bracket nor a line.
		const path = bracketPath(100, 110, 200);
		expect(path).not.toContain("Q");
	});

	it("returns nothing for a zero-width family", () => {
		expect(bracketPath(100, 100, 200)).toBe("");
	});
});

describe("MAX_BAR_SPAN", () => {
	it("is narrow enough to have rejected the 6013px bar measured on the canvas", () => {
		// Not a taste threshold: the sample tree really did draw a 6013px horizontal line
		// against a 200px median, and that single mark is what made the canvas look wrong.
		expect(MAX_BAR_SPAN).toBeLessThan(6013);
		// And wide enough to keep the ordinary case as a bracket, which is what the bar is
		// for -- the median family is 200px and a typical wide one around 800px.
		expect(MAX_BAR_SPAN).toBeGreaterThan(800);
	});
});
