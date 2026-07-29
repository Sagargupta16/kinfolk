/**
 * The sibling bar's job is to say which children belong to which parents. The one
 * way it can lie is by sharing a line with another family, so that is what these
 * assert -- a property, not an appearance.
 */
import { describe, expect, it } from "vitest";
import type { UnionWithChildren } from "./graph";
import type { PositionedNode } from "./layout";
import { barCollisions, siblingBars } from "./siblings";

function personAt(id: string, x: number, y: number): PositionedNode {
	return {
		id,
		type: "person",
		data: {},
		position: { x, y },
		width: 168,
		height: 78,
	} as unknown as PositionedNode;
}

function unionAt(id: string, x: number, y: number): PositionedNode {
	return {
		id: `union:${id}`,
		type: "union",
		data: {},
		position: { x, y },
		width: 12,
		height: 12,
	} as unknown as PositionedNode;
}

function union(id: string, childIds: string[]): UnionWithChildren {
	return { id, partnerAId: null, partnerBId: null, childIds } as unknown as UnionWithChildren;
}

describe("siblingBars", () => {
	it("spans the children's centres, not their edges", () => {
		// The bar is where drop lines leave and arrive, and a drop leaves the middle of
		// a card. Spanning the outer edges would leave two stubs hanging past the
		// outermost siblings.
		const bars = siblingBars(
			[union("u1", ["a", "b"])],
			[unionAt("u1", 400, 100), personAt("a", 0, 300), personAt("b", 800, 300)],
		);

		const bar = bars.get("union:u1");
		expect(bar?.left).toBe(84);
		expect(bar?.right).toBe(884);
	});

	it("skips a union with one child", () => {
		// A bar from a person to themselves is a line with no meaning, and the plain
		// drop already reads correctly.
		const bars = siblingBars(
			[union("u1", ["a"])],
			[unionAt("u1", 400, 100), personAt("a", 400, 300)],
		);
		expect(bars.size).toBe(0);
	});

	it("shares one lane between families that cannot collide", () => {
		// The common case, and the reason lanes are assigned rather than handed out
		// per family: two households side by side keep a single clean line across the
		// generation, which is what makes the bar read as structure.
		const bars = siblingBars(
			[union("u1", ["a", "b"]), union("u2", ["c", "d"])],
			[
				unionAt("u1", 100, 100),
				unionAt("u2", 2100, 100),
				personAt("a", 0, 300),
				personAt("b", 400, 300),
				personAt("c", 2000, 300),
				personAt("d", 2400, 300),
			],
		);

		expect(bars.get("union:u1")?.lane).toBe(0);
		expect(bars.get("union:u2")?.lane).toBe(0);
		expect(bars.get("union:u1")?.y).toBe(bars.get("union:u2")?.y);
		expect(barCollisions(bars)).toBe(0);
	});

	it("moves an overlapping family to its own lane", () => {
		// The bug this file exists for. Two unions whose children interleave produced
		// ONE horizontal line at the same y, so a reader could not tell whose child was
		// whose. Measured on the sample tree: two such pairs in the generation with the
		// widest spans.
		const bars = siblingBars(
			[union("u1", ["a", "d"]), union("u2", ["b", "c"])],
			[
				unionAt("u1", 100, 100),
				unionAt("u2", 500, 100),
				personAt("a", 0, 300),
				personAt("b", 400, 300),
				personAt("c", 800, 300),
				personAt("d", 1200, 300),
			],
		);

		expect(bars.get("union:u1")?.lane).not.toBe(bars.get("union:u2")?.lane);
		expect(barCollisions(bars)).toBe(0);
	});

	it("gives the widest family the nearest lane", () => {
		// Ordered widest first, because a wide bar overlaps more neighbours: placing it
		// while lanes are free keeps the crowded case out of the wrapped lane.
		const bars = siblingBars(
			[union("narrow", ["b", "c"]), union("wide", ["a", "d"])],
			[
				unionAt("narrow", 500, 100),
				unionAt("wide", 100, 100),
				personAt("a", 0, 300),
				personAt("b", 400, 300),
				personAt("c", 600, 300),
				personAt("d", 3000, 300),
			],
		);

		expect(bars.get("union:wide")?.lane).toBe(0);
		expect(bars.get("union:narrow")?.lane).toBe(1);
	});

	it("keeps lanes per generation gap rather than global", () => {
		// Two families in different generations can never collide, so competing for
		// lanes would push a bar away from its own children for nothing.
		const bars = siblingBars(
			[union("upper", ["a", "b"]), union("lower", ["c", "d"])],
			[
				unionAt("upper", 100, 100),
				unionAt("lower", 100, 400),
				personAt("a", 0, 300),
				personAt("b", 400, 300),
				personAt("c", 0, 600),
				personAt("d", 400, 600),
			],
		);

		expect(bars.get("union:upper")?.lane).toBe(0);
		expect(bars.get("union:lower")?.lane).toBe(0);
		expect(bars.get("union:upper")?.y).toBe(300 - 9);
		expect(bars.get("union:lower")?.y).toBe(600 - 9);
	});

	it("never puts the bar above its own parents", () => {
		// A bar that overshoots the union dot points the drop line UPWARDS, which reads
		// as the children being the ancestors. Happens when the gap is tight and the
		// lane offset is larger than the room available.
		const bars = siblingBars(
			[union("u1", ["a", "b"])],
			// Union bottom at 292, children at 300: 8px of room for a 9px lane offset.
			[unionAt("u1", 400, 280), personAt("a", 0, 300), personAt("b", 800, 300)],
		);

		const bar = bars.get("union:u1");
		expect(bar?.y).toBe(294);
		expect((bar?.y ?? 0) > 292).toBe(true);
	});

	it("ignores a union whose dot is not on the canvas", () => {
		// Mine-only mode drops a whole tree, so a union can survive fusion with its dot
		// filtered out of the projection.
		expect(siblingBars([union("gone", ["a", "b"])], [personAt("a", 0, 300)]).size).toBe(0);
	});

	it("ignores children who are not drawn", () => {
		// A child in a tree the viewer cannot see is not on the canvas, and a bar
		// stretching to where they would have been points at nothing.
		const bars = siblingBars(
			[union("u1", ["a", "b", "hidden"])],
			[unionAt("u1", 400, 100), personAt("a", 0, 300), personAt("b", 800, 300)],
		);
		expect(bars.get("union:u1")?.right).toBe(884);
	});
});

describe("barCollisions", () => {
	it("counts only bars that share a y AND overlap in x", () => {
		// Two bars on the same y that do not overlap are two separate lines, which is
		// the whole reason lane sharing is allowed.
		const separate = siblingBars(
			[union("u1", ["a", "b"]), union("u2", ["c", "d"])],
			[
				unionAt("u1", 100, 100),
				unionAt("u2", 2100, 100),
				personAt("a", 0, 300),
				personAt("b", 400, 300),
				personAt("c", 2000, 300),
				personAt("d", 2400, 300),
			],
		);
		expect(barCollisions(separate)).toBe(0);
	});
});
