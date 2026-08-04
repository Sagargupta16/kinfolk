/**
 * The orbit layout's one claim is that radius means distance from the focus. These
 * assert exactly that, plus the overlap arithmetic that makes a crowded ring legible --
 * both properties you check rather than look at.
 */
import { describe, expect, it } from "vitest";
import type { FlowEdge, FlowNode, FusedPerson } from "./graph";
import { NODE_METRICS } from "./layout";
import { collapseUnionEdges, hopsFrom, radialLayout, ringRadius } from "./radial";

function person(id: string): FlowNode {
	return {
		id,
		type: "person",
		data: { id, primary: { id } } as unknown as FusedPerson,
	};
}

function edge(
	id: string,
	source: string,
	target: string,
	kind: FlowEdge["kind"] = "child",
): FlowEdge {
	return { id, source, target, kind, layout: kind !== "relation" };
}

/** Centre of a laid-out node, which is what the ring maths is actually about. */
function centre(node: { position: { x: number; y: number }; width: number; height: number }) {
	return {
		x: node.position.x + node.width / 2,
		y: node.position.y + node.height / 2,
	};
}

function radiusOf(node: Parameters<typeof centre>[0]): number {
	const c = centre(node);
	return Math.hypot(c.x, c.y);
}

describe("hopsFrom", () => {
	it("counts a union dot as a hop, so a partner is nearer than a child", () => {
		// The whole reason the junction is not collapsed: your children really are one step
		// further from you than your partner is, and the ring should say so.
		const edges = [
			edge("p1", "me", "union:u1", "partner"),
			edge("p2", "spouse", "union:u1", "partner"),
			edge("c1", "union:u1", "kid"),
		];
		const hops = hopsFrom(edges, "me");

		expect(hops.get("me")).toBe(0);
		expect(hops.get("union:u1")).toBe(1);
		expect(hops.get("spouse")).toBe(2);
		expect(hops.get("kid")).toBe(2);
	});

	it("takes the SHORTEST route when a branch rejoins", () => {
		// Cousins marry, so the same person is reachable at several depths. Only the nearest
		// is honest.
		const edges = [
			edge("a", "me", "x"),
			edge("b", "x", "y"),
			edge("c", "y", "far"),
			edge("d", "me", "far"),
		];
		expect(hopsFrom(edges, "me").get("far")).toBe(1);
	});

	it("omits anybody with no path to the focus", () => {
		expect(hopsFrom([edge("a", "me", "x")], "me").has("stranger")).toBe(false);
	});
});

describe("ringRadius", () => {
	it("scales with the number of nodes on the ring", () => {
		// The arithmetic that makes a fixed radius per ring impossible: a 45-node ring needs
		// roughly seven times the radius of a 6-node one, so one fixed value either wastes
		// the canvas or overlaps every card.
		const six = ringRadius(6, 168);
		const fortyFive = ringRadius(45, 168);
		expect(fortyFive / six).toBeGreaterThan(6);
	});

	it("gives every node an arc at least as long as its own width", () => {
		const count = 20;
		const width = NODE_METRICS.full.width;
		const r = ringRadius(count, width);
		const arcPerNode = (2 * Math.PI * r) / count;
		expect(arcPerNode).toBeGreaterThanOrEqual(width);
	});

	it("returns zero for a ring of one, which needs no spreading", () => {
		// Guarded because the formula would otherwise hand back a radius for a single node
		// and push it away from a centre it is the only neighbour of.
		expect(ringRadius(1, 168)).toBe(0);
		expect(ringRadius(0, 168)).toBe(0);
	});
});

describe("radialLayout", () => {
	/** me -> child -> grandchild, plus a friend of `me`. */
	function graph(): { nodes: FlowNode[]; edges: FlowEdge[] } {
		return {
			nodes: [person("me"), person("child"), person("grandchild"), person("friend")],
			edges: [
				edge("e1", "me", "child"),
				edge("e2", "child", "grandchild"),
				edge("e3", "me", "friend", "relation"),
			],
		};
	}

	it("puts the focus at the origin", () => {
		const { nodes, rings } = radialLayout(graph().nodes, graph().edges, "me");
		const me = nodes.find((n) => n.id === "me");
		expect(me?.ring).toBe(0);
		// Dead centre, because every angle on every ring is measured from this point.
		expect(centre(me as Parameters<typeof centre>[0])).toEqual({ x: 0, y: 0 });
		// Ring 0 has no radius by definition.
		expect(rings[0]).toBe(0);
	});

	it("orders radius by hops, which is the entire encoding", () => {
		const { nodes } = radialLayout(graph().nodes, graph().edges, "me");
		const byId = new Map(nodes.map((n) => [n.id, n]));

		const child = byId.get("child");
		const grandchild = byId.get("grandchild");
		expect(child && grandchild && radiusOf(child) < radiusOf(grandchild)).toBe(true);
	});

	it("places a close friend on the SAME ring as a child, since both are one hop", () => {
		// This view answers closeness, not generation -- that is the difference from the
		// layered canvas, where a friendship must never influence placement.
		const { nodes } = radialLayout(graph().nodes, graph().edges, "me");
		const byId = new Map(nodes.map((n) => [n.id, n]));
		expect(byId.get("friend")?.ring).toBe(byId.get("child")?.ring);
	});

	it("never overlaps two nodes on the same ring", () => {
		// 24 siblings, which forces a sub-ring split.
		const kids = Array.from({ length: 24 }, (_, i) => person(`kid${i}`));
		const nodes = [person("me"), ...kids];
		const edges = kids.map((k, i) => edge(`e${i}`, "me", k.id));

		const laid = radialLayout(nodes, edges, "me").nodes.filter((n) => n.ring === 1);

		for (let i = 0; i < laid.length; i += 1) {
			for (let j = i + 1; j < laid.length; j += 1) {
				const a = laid[i];
				const b = laid[j];
				if (!a || !b) continue;
				const overlaps =
					a.position.x < b.position.x + b.width &&
					b.position.x < a.position.x + a.width &&
					a.position.y < b.position.y + b.height &&
					b.position.y < a.position.y + a.height;
				expect(overlaps).toBe(false);
			}
		}
	});

	it("keeps siblings ADJACENT on their ring, which is what keeps edges short", () => {
		/*
		 * The wedge allocation's real job, stated as the property that matters.
		 *
		 * An earlier version of this test asserted that a fan of four occupied less than half
		 * the circle, and that assertion was wrong: with nothing else on their ring those four
		 * SHOULD spread evenly around it, because there is nobody to crowd them and a quarter of
		 * the circle sitting empty is wasted canvas. Spacing is even by design -- what wedges
		 * decide is the ORDER, not the gaps.
		 *
		 * So the honest property is contiguity: two families on one ring must not interleave,
		 * because that is what forces an edge to reach across the circle. Measured before wedge
		 * allocation existed: median edge span 122 degrees, 26 of 34 over 90.
		 */
		const nodes = [
			person("me"),
			person("parentA"),
			person("parentB"),
			...["a1", "a2", "a3"].map((id) => person(id)),
			...["b1", "b2", "b3"].map((id) => person(id)),
		];
		const edges = [
			edge("e1", "me", "parentA"),
			edge("e2", "me", "parentB"),
			...["a1", "a2", "a3"].map((id, i) => edge(`fa${i}`, "parentA", id)),
			...["b1", "b2", "b3"].map((id, i) => edge(`fb${i}`, "parentB", id)),
		];

		const laid = radialLayout(nodes, edges, "me");
		const ring2 = laid.nodes
			.filter((n) => n.ring === 2)
			.sort((x, y) => (x.angle ?? 0) - (y.angle ?? 0))
			.map((n) => n.id);

		// Each family occupies a contiguous run: walking the ring, the A children are together
		// and the B children are together, never A B A.
		const family = ring2.map((id) => id[0]);
		const switches = family.filter((letter, i) => i > 0 && letter !== family[i - 1]).length;
		expect(ring2).toHaveLength(6);
		// One switch is the boundary between the two families. More means they interleave.
		expect(switches).toBeLessThanOrEqual(1);
	});

	it("omits anybody unreachable from the focus", () => {
		// Their radius would be a claim about a distance that does not exist.
		const nodes = [person("me"), person("stranger")];
		const laid = radialLayout(nodes, [], "me");
		expect(laid.nodes.map((n) => n.id)).toEqual(["me"]);
	});

	it("returns nothing when the focus is not in the graph", () => {
		// Guessing a focus would put a stranger at the centre of somebody's family.
		expect(radialLayout([person("a")], [], "nobody").nodes).toEqual([]);
	});

	it("returns an empty result for an empty graph", () => {
		expect(radialLayout([], [], "me")).toEqual({
			nodes: [],
			rings: [0],
			extent: { x: 0, y: 0, width: 0, height: 0 },
		});
	});

	it("does not place union dots on a ring at all", () => {
		/*
		 * Changed deliberately from an earlier assertion that a junction was placed at 12x12.
		 *
		 * A union is a marriage rather than a relationship STEP, so it has no honest radius --
		 * and placing one cost a full ring step per generation for a 12x12 mark, which took the
		 * outermost ring to 3641px and made the orbit wider than the pedigree. CLAUDE.md already
		 * says a union dot is "the MARRIAGE, not a route to the children"; this view takes that
		 * literally and joins the people directly.
		 */
		const nodes: FlowNode[] = [
			person("me"),
			person("spouse"),
			{
				id: "union:u1",
				type: "union",
				data: { union: { id: "u1", childIds: [] } },
			} as unknown as FlowNode,
		];
		const edges = [
			edge("p1", "me", "union:u1", "partner"),
			edge("p2", "spouse", "union:u1", "partner"),
		];

		const laid = radialLayout(nodes, collapseUnionEdges(nodes, edges), "me");
		expect(laid.nodes.find((n) => n.id === "union:u1")).toBeUndefined();
		// And the spouse is now ONE hop away rather than two, which is what a closeness view
		// should say about a partner.
		expect(laid.nodes.find((n) => n.id === "spouse")?.ring).toBe(1);
	});

	it("rewrites family edges person-to-person when junctions are dropped", () => {
		const nodes: FlowNode[] = [
			person("mum"),
			person("dad"),
			person("kid"),
			{
				id: "union:u1",
				type: "union",
				data: { union: { id: "u1", childIds: ["kid"] } },
			} as unknown as FlowNode,
		];
		const edges = [
			edge("p1", "mum", "union:u1", "partner"),
			edge("p2", "dad", "union:u1", "partner"),
			edge("c1", "union:u1", "kid"),
		];

		const collapsed = collapseUnionEdges(nodes, edges);
		// No edge may still point at the junction, or it would dangle on a canvas that does not
		// draw it.
		expect(
			collapsed.every((e) => !e.source.startsWith("union:") && !e.target.startsWith("union:")),
		).toBe(true);
		// The couple, plus one edge per parent to the child.
		expect(collapsed.filter((e) => e.kind === "partner")).toHaveLength(1);
		expect(collapsed.filter((e) => e.kind === "child")).toHaveLength(2);
	});

	it("passes relation edges through the collapse untouched", () => {
		// They never touched a junction, so there is nothing to rewrite.
		const nodes = [person("a"), person("b")];
		const edges = [edge("r1", "a", "b", "relation")];
		expect(collapseUnionEdges(nodes, edges)).toEqual(edges);
	});

	it("shrinks with the level of detail, like the layered view", () => {
		const kids = Array.from({ length: 8 }, (_, i) => person(`kid${i}`));
		const nodes = [person("me"), ...kids];
		const edges = kids.map((k, i) => edge(`e${i}`, "me", k.id));

		const full = radialLayout(nodes, edges, "me", "full").extent;
		const dot = radialLayout(nodes, edges, "me", "dot").extent;
		expect(dot.width).toBeLessThan(full.width);
	});

	it("spreads a two-node ring sideways rather than stacking it vertically", () => {
		// The half-slot offset: without it, two nodes land directly above and below the
		// focus and the ring reads as a vertical line.
		const nodes = [person("me"), person("a"), person("b")];
		const laid = radialLayout(nodes, [edge("e1", "me", "a"), edge("e2", "me", "b")], "me");
		const ring = laid.nodes.filter((n) => n.ring === 1);
		expect(Math.abs((ring[0]?.position.x ?? 0) - (ring[1]?.position.x ?? 0))).toBeGreaterThan(1);
	});
});
