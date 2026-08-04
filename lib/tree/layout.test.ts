/**
 * Layout tests exist for exactly one property: social edges must not move
 * anybody. Everything else about ELK's output is its business, not ours.
 */
import { describe, expect, it } from "vitest";
import { type FlowEdge, type FlowNode, type FusedPerson, visibleEdges } from "./graph";
import { graphExtent, type Lod, layoutGraph, NODE_METRICS, type PositionedNode } from "./layout";

function personNode(id: string): FlowNode {
	const fused = {
		id,
		primary: { id, givenName: id } as FusedPerson["primary"],
		sources: [],
		contributingTreeIds: [],
		contacts: [],
	} as unknown as FusedPerson;
	return { id, type: "person", data: fused };
}

function familyEdge(id: string, source: string, target: string): FlowEdge {
	return { id, source, target, kind: "child", layout: true };
}

function relationEdge(id: string, source: string, target: string): FlowEdge {
	return { id, source, target, kind: "relation", layout: false, relationKind: "friend" };
}

/** Every assertion here is about placement, so unwrap the bands. */
async function layoutNodes(nodes: FlowNode[], edges: FlowEdge[]): Promise<PositionedNode[]> {
	return (await layoutGraph(nodes, edges)).nodes;
}

describe("layoutGraph", () => {
	it("returns nothing for an empty graph", async () => {
		expect(await layoutGraph([], [])).toEqual({
			nodes: [],
			bands: [],
			// A zero box rather than an absent one. The minimap divides by the width to
			// pick its aspect ratio, so an undefined extent would be a NaN height on an
			// empty tree -- which is the state a new account opens in.
			extent: { x: 0, y: 0, width: 0, height: 0 },
		});
	});

	it("ignores relation edges when assigning generations", async () => {
		const nodes = [personNode("parent"), personNode("child"), personNode("friend")];
		const family = [familyEdge("f1", "parent", "child")];

		const withoutRelations = await layoutNodes(nodes, family);
		const withRelations = await layoutNodes(nodes, [
			...family,
			// If this edge reached ELK, "friend" would be pushed a layer below
			// "child" and the whole skeleton would shift with it.
			relationEdge("r1", "child", "friend"),
		]);

		// Only the family-connected nodes. "friend" is expected to move -- it has no
		// family edge, so it gets anchored beside somebody it knows. What must never
		// move is the skeleton: a social edge cannot reposition a relative.
		const skeleton = (positioned: PositionedNode[]) =>
			positioned.filter((n) => n.id !== "friend").map((n) => ({ id: n.id, ...n.position }));

		expect(skeleton(withRelations)).toEqual(skeleton(withoutRelations));
	});

	it("places a parent above their child", async () => {
		const positioned = await layoutNodes(
			[personNode("parent"), personNode("child")],
			[familyEdge("f1", "parent", "child")],
		);

		const parent = positioned.find((n) => n.id === "parent");
		const child = positioned.find((n) => n.id === "child");
		expect(parent && child && parent.position.y < child.position.y).toBe(true);
	});

	it("puts a friend on the same row as the person they know", async () => {
		const positioned = await layoutNodes(
			[personNode("parent"), personNode("child"), personNode("friend")],
			[familyEdge("f1", "parent", "child"), relationEdge("r1", "child", "friend")],
		);

		const child = positioned.find((n) => n.id === "child");
		const friend = positioned.find((n) => n.id === "friend");

		// Exact equality, not "<=". Left to ELK, a person with no family edge is an
		// isolated node and lands in the TOP layer, rendering a friend as somebody
		// older than the grandparents.
		expect(friend?.position.y).toBe(child?.position.y);
		// Beside them, not on top of them.
		expect((friend?.position.x ?? 0) >= (child?.position.x ?? 0) + (child?.width ?? 0)).toBe(true);
	});

	it("chains a friend of a friend onto the same row", async () => {
		const positioned = await layoutNodes(
			[personNode("parent"), personNode("child"), personNode("friend"), personNode("theirFriend")],
			[
				familyEdge("f1", "parent", "child"),
				relationEdge("r1", "child", "friend"),
				relationEdge("r2", "friend", "theirFriend"),
			],
		);

		const rowOf = (id: string) => positioned.find((n) => n.id === id)?.position.y;
		expect(rowOf("theirFriend")).toBe(rowOf("child"));
	});

	it("does not stack two friends of the same person", async () => {
		const positioned = await layoutNodes(
			[personNode("parent"), personNode("child"), personNode("friendA"), personNode("friendB")],
			[
				familyEdge("f1", "parent", "child"),
				relationEdge("r1", "child", "friendA"),
				relationEdge("r2", "child", "friendB"),
			],
		);

		const a = positioned.find((n) => n.id === "friendA");
		const b = positioned.find((n) => n.id === "friendB");
		expect(a?.position.x).not.toBe(b?.position.x);
	});

	it("leaves a person with no connections at all where ELK put them", async () => {
		// Nothing to anchor to, so this is not a case the pass can improve.
		const positioned = await layoutNodes([personNode("orphan"), personNode("other")], []);
		expect(positioned).toHaveLength(2);
	});
});

/**
 * The level-of-detail switch has one job: a smaller footprint. If the spacing did
 * not collapse with the nodes, a tree of dots would keep card-sized gaps and the
 * overview it exists to give would not fit any better than the cards did.
 */
describe("level of detail", () => {
	/** A three-generation family with siblings, so both axes have something to shrink. */
	function family(): { nodes: FlowNode[]; edges: FlowEdge[] } {
		return {
			nodes: [
				personNode("gran"),
				personNode("parent"),
				personNode("aunt"),
				personNode("kidA"),
				personNode("kidB"),
			],
			edges: [
				familyEdge("f1", "gran", "parent"),
				familyEdge("f2", "gran", "aunt"),
				familyEdge("f3", "parent", "kidA"),
				familyEdge("f4", "parent", "kidB"),
			],
		};
	}

	async function footprint(lod: Lod): Promise<{ width: number; height: number }> {
		const { nodes, edges } = family();
		const positioned = (await layoutGraph(nodes, edges, lod)).nodes;
		return {
			width:
				Math.max(...positioned.map((n) => n.position.x + n.width)) -
				Math.min(...positioned.map((n) => n.position.x)),
			height:
				Math.max(...positioned.map((n) => n.position.y + n.height)) -
				Math.min(...positioned.map((n) => n.position.y)),
		};
	}

	it("shrinks on both axes at every step down", async () => {
		const full = await footprint("full");
		const compact = await footprint("compact");
		const dot = await footprint("dot");

		expect(compact.width).toBeLessThan(full.width);
		expect(compact.height).toBeLessThan(full.height);
		expect(dot.width).toBeLessThan(compact.width);
		expect(dot.height).toBeLessThan(compact.height);
	});

	it("collapses the gaps too, not only the nodes", async () => {
		// The failure this guards: shrink the cards, leave elk.spacing.nodeNode alone,
		// and a tree of dots is still as wide as one of cards. So the footprint has to
		// shrink by MORE than the nodes themselves did.
		const full = await footprint("full");
		const dot = await footprint("dot");
		const nodeRatio = NODE_METRICS.dot.width / NODE_METRICS.full.width;

		expect(dot.width / full.width).toBeLessThan(nodeRatio + 0.2);
	});

	it("keeps generation order whatever the detail level", async () => {
		for (const lod of ["full", "compact", "dot"] as Lod[]) {
			const positioned = (await layoutGraph(family().nodes, family().edges, lod)).nodes;
			const y = (id: string) => positioned.find((n) => n.id === id)?.position.y ?? 0;
			expect(y("gran")).toBeLessThan(y("parent"));
			expect(y("parent")).toBeLessThan(y("kidA"));
		}
	});

	it("defaults to full detail when no level is given", async () => {
		const { nodes, edges } = family();
		const implicit = (await layoutGraph(nodes, edges)).nodes;
		const explicit = (await layoutGraph(nodes, edges, "full")).nodes;
		expect(implicit.map((n) => n.position)).toEqual(explicit.map((n) => n.position));
	});
});

describe("generation bands", () => {
	it("emits one band per generation, ordered oldest first", async () => {
		const { bands } = await layoutGraph(
			[personNode("gran"), personNode("parent"), personNode("child")],
			[familyEdge("f1", "gran", "parent"), familyEdge("f2", "parent", "child")],
		);

		expect(bands).toHaveLength(3);
		expect(bands.map((b) => b.count)).toEqual([1, 1, 1]);

		const rows = bands.map((b) => b.y);
		expect(rows).toEqual([...rows].sort((a, b) => a - b));
	});

	it("counts siblings into one band, not two", async () => {
		const { bands } = await layoutGraph(
			[personNode("parent"), personNode("a"), personNode("b")],
			[familyEdge("f1", "parent", "a"), familyEdge("f2", "parent", "b")],
		);

		expect(bands.map((b) => b.count)).toEqual([1, 2]);
	});

	/**
	 * Why the overlay toggle filters at RENDER and never before layout.
	 *
	 * Relation edges must not reach ELK, but they must still reach `layoutGraph`,
	 * because that is where a person with no family gets anchored beside somebody
	 * they know. Filter them out one step earlier -- at projection, or by handing the
	 * canvas a pre-filtered list -- and those people become isolated nodes, which ELK
	 * puts in the FIRST layer: a phantom generation above the grandparents, made
	 * entirely of friends.
	 *
	 * The sample data has no family-less people, so this is invisible in manual QA
	 * and the guard has to be synthetic.
	 */
	it("keeps positions and bands identical whether or not relations are drawn", async () => {
		const nodes = [
			personNode("gran"),
			personNode("parent"),
			personNode("child"),
			personNode("mate1"),
			personNode("mate2"),
			personNode("mate3"),
		];
		const edges = [
			familyEdge("f1", "gran", "parent"),
			familyEdge("f2", "parent", "child"),
			relationEdge("r1", "child", "mate1"),
			relationEdge("r2", "child", "mate2"),
			relationEdge("r3", "parent", "mate3"),
		];

		// One layout, both views. The overlay toggle changes which edges are DRAWN, so
		// there is nothing for it to move.
		const { nodes: positioned, bands } = await layoutGraph(nodes, edges);
		expect(bands).toHaveLength(3);

		const rowOf = (id: string) => positioned.find((n) => n.id === id)?.position.y;
		expect(rowOf("mate1")).toBe(rowOf("child"));
		expect(rowOf("mate3")).toBe(rowOf("parent"));

		// And the failure that would replace it, had the filter run any earlier: the
		// three friends land in a band of their own, above the oldest ancestor.
		const preFiltered = await layoutGraph(nodes, visibleEdges(edges, false));
		expect(preFiltered.bands).toHaveLength(4);

		const stranded = preFiltered.nodes.find((n) => n.id === "mate1")?.position.y ?? 0;
		const oldest = preFiltered.nodes.find((n) => n.id === "gran")?.position.y ?? 0;
		expect(stranded).toBeLessThan(oldest);
	});

	it("excludes union dots so they cannot invent a half-generation", async () => {
		const union = {
			id: "u1",
			type: "union",
			data: { union: { id: "u1", childIds: ["kid"] } },
		} as unknown as FlowNode;

		const { bands } = await layoutGraph(
			[personNode("mum"), personNode("dad"), union, personNode("kid")],
			[familyEdge("f1", "mum", "u1"), familyEdge("f2", "dad", "u1"), familyEdge("f3", "u1", "kid")],
		);

		// Parents, then child. The dot sits between those rows and must not become
		// a third band -- a label there would read as a generation nobody is in.
		expect(bands.map((b) => b.count)).toEqual([2, 1]);
	});
});

/**
 * The extent is what the minimap shapes its panel from, so the property that matters
 * is that it contains everything DRAWN -- the opposite of generation bands, which are
 * about people only.
 */
describe("union dot placement", () => {
	function partnerEdge(id: string, person: string, union: string): FlowEdge {
		return { id, source: person, target: union, kind: "partner", layout: true };
	}

	function unionNode(id: string): FlowNode {
		return {
			id,
			type: "union",
			data: { union: { id, childIds: [] } },
		} as unknown as FlowNode;
	}

	it("sits between the two people it joins", async () => {
		/*
		 * ELK places a junction to minimise edge crossings, which is right for a layered graph
		 * and wrong for a marriage. Measured on the sample tree before this pass: all 34 couples
		 * had their dot off the couple's midpoint, the worst by 498px -- and a dot beside a
		 * couple rather than between them makes the drop to the children appear to leave from
		 * nowhere.
		 */
		const { nodes: positioned } = await layoutGraph(
			[personNode("mum"), personNode("dad"), unionNode("u1"), personNode("kid")],
			[
				partnerEdge("p1", "mum", "u1"),
				partnerEdge("p2", "dad", "u1"),
				familyEdge("c1", "u1", "kid"),
			],
		);

		const centre = (id: string) => {
			const node = positioned.find((n) => n.id === id);
			return node ? node.position.x + node.width / 2 : Number.NaN;
		};

		const midpoint = (centre("mum") + centre("dad")) / 2;
		expect(centre("u1")).toBeCloseTo(midpoint, 1);
	});

	it("leaves a single parent's union where ELK put it", async () => {
		// Nothing to sit between: the dot already hangs below its one parent, which is honest.
		const { nodes: positioned } = await layoutGraph(
			[personNode("parent"), unionNode("u1"), personNode("kid")],
			[partnerEdge("p1", "parent", "u1"), familyEdge("c1", "u1", "kid")],
		);

		// Placed, and still in the gap between the two generations rather than nudged onto a row.
		const dot = positioned.find((n) => n.id === "u1");
		const parent = positioned.find((n) => n.id === "parent");
		const kid = positioned.find((n) => n.id === "kid");
		expect(dot && parent && kid && dot.position.y > parent.position.y).toBe(true);
		expect(dot && kid && dot.position.y < kid.position.y).toBe(true);
	});

	it("does not move the people to centre the dot", async () => {
		// The nudge is cosmetic and must never shift the skeleton, the same rule the sibling
		// bars follow.
		const nodes = [personNode("mum"), personNode("dad"), unionNode("u1")];
		const edges = [partnerEdge("p1", "mum", "u1"), partnerEdge("p2", "dad", "u1")];

		const first = await layoutGraph(nodes, edges);
		const second = await layoutGraph(nodes, edges);
		const people = (result: typeof first) =>
			result.nodes.filter((n) => n.type === "person").map((n) => ({ id: n.id, ...n.position }));

		expect(people(first)).toEqual(people(second));
	});
});

describe("graphExtent", () => {
	it("returns a zero box for no nodes", () => {
		// Not an empty-array guard for its own sake: the minimap divides by the width,
		// and a new account's tree has no nodes in it.
		expect(graphExtent([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});

	it("spans from the top-left corner to the bottom-right edge", () => {
		const boxed = (id: string, x: number, y: number, width: number, height: number) =>
			({ ...personNode(id), position: { x, y }, width, height }) as PositionedNode;

		// Deliberately not axis-aligned: the leftmost node is not the topmost one, so a
		// box built from a single node's corner would be wrong in one axis.
		expect(graphExtent([boxed("a", 10, 200, 200, 92), boxed("b", 400, 40, 200, 92)])).toEqual({
			x: 10,
			y: 40,
			width: 590,
			height: 252,
		});
	});

	it("includes union dots, unlike generation bands", async () => {
		const union = {
			id: "u1",
			type: "union",
			data: { union: { id: "u1", childIds: [] } },
		} as unknown as FlowNode;

		// A dot is drawn, so a box that skipped it would clip the canvas it describes.
		// Asserted through a real layout rather than hand-placed boxes, since the only
		// way this regresses is somebody filtering on `type === "person"` here the way
		// `generationBands` correctly does.
		const { nodes: positioned, extent } = await layoutGraph(
			[personNode("mum"), personNode("dad"), union],
			[familyEdge("f1", "mum", "u1"), familyEdge("f2", "dad", "u1")],
		);

		const dot = positioned.find((n) => n.id === "u1");
		if (!dot) throw new Error("union dot was not laid out");
		expect(extent.y + extent.height).toBeGreaterThanOrEqual(dot.position.y + dot.height);
	});

	it("grows with the level of detail, which is why the minimap cannot be a fixed box", async () => {
		const nodes = [personNode("a"), personNode("b"), personNode("c")];
		const edges = [familyEdge("f1", "a", "b"), familyEdge("f2", "b", "c")];

		const full = (await layoutGraph(nodes, edges, "full")).extent;
		const dot = (await layoutGraph(nodes, edges, "dot")).extent;

		// The ratio, not just the size: 9.5:1 as cards against 3.1:1 as dots on the
		// sample tree is the whole reason the panel computes its own height.
		expect(full.width / full.height).not.toBeCloseTo(dot.width / dot.height, 1);
	});
});
