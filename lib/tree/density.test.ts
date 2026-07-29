/**
 * Density tests guard two properties that are easy to break and hard to see: a
 * union dot must never count as a connection, and family and social ties must
 * never be summed into one number.
 */
import { describe, expect, it } from "vitest";
import { degrees } from "./density";
import type { FlowEdge, FlowNode, FusedPerson } from "./graph";

function personNode(id: string): FlowNode {
	return { id, type: "person", data: { id } as unknown as FusedPerson };
}

function unionNode(id: string): FlowNode {
	return { id, type: "union", data: { union: { id } } as unknown as never };
}

function familyEdge(id: string, source: string, target: string): FlowEdge {
	return { id, source, target, kind: "child", layout: true };
}

function relationEdge(id: string, source: string, target: string, closeness = 1): FlowEdge {
	return {
		id,
		source,
		target,
		kind: "relation",
		layout: false,
		relationKind: "friend",
		closeness: closeness as 1 | 2 | 3,
	};
}

/** A couple with two children, joined through one union dot. */
function household() {
	const nodes = [
		personNode("mum"),
		personNode("dad"),
		unionNode("u1"),
		personNode("kidA"),
		personNode("kidB"),
	];
	const edges = [
		familyEdge("f1", "mum", "u1"),
		familyEdge("f2", "dad", "u1"),
		familyEdge("f3", "u1", "kidA"),
		familyEdge("f4", "u1", "kidB"),
	];
	return { nodes, edges };
}

describe("degrees", () => {
	it("counts through a union dot rather than counting the dot", () => {
		const { nodes, edges } = household();
		const d = degrees(nodes, edges);

		// Three others on the dot: partner plus two children.
		expect(d.get("mum")?.family).toBe(3);
		// A child sees the two parents and one sibling.
		expect(d.get("kidA")?.family).toBe(3);
	});

	it("gives union dots no entry at all", () => {
		const { nodes, edges } = household();
		expect(degrees(nodes, edges).has("u1")).toBe(false);
	});

	it("scores a person whose only edge is their own union as unconnected", () => {
		// One partner recorded, nobody else: the dot is scaffolding, not a connection.
		const nodes = [personNode("solo"), unionNode("u1")];
		const edges = [familyEdge("f1", "solo", "u1")];
		expect(degrees(nodes, edges).get("solo")?.family).toBe(0);
	});

	it("keeps family and social counts apart", () => {
		const { nodes, edges } = household();
		const d = degrees([...nodes, personNode("pal")], [...edges, relationEdge("r1", "mum", "pal")]);

		expect(d.get("mum")).toMatchObject({ family: 3, social: 1 });
	});

	it("weights a social edge by its closeness", () => {
		const nodes = [personNode("a"), personNode("b"), personNode("c")];
		const d = degrees(nodes, [relationEdge("r1", "a", "b", 3), relationEdge("r2", "a", "c", 1)]);

		expect(d.get("a")?.social).toBe(4);
		expect(d.get("b")?.social).toBe(3);
	});

	it("ranks the busiest person at 1 and gives everyone else less", () => {
		const { nodes, edges } = household();
		const d = degrees([...nodes, personNode("pal")], [...edges, relationEdge("r1", "mum", "pal")]);

		expect(d.get("mum")?.rank).toBe(1);
		expect((d.get("pal")?.rank ?? 1) < 1).toBe(true);
	});

	it("ranks relative to the graph, so a small tree still has a hub", () => {
		// Two people, one tie each. Both are as connected as anyone here is.
		const d = degrees([personNode("a"), personNode("b")], [relationEdge("r1", "a", "b")]);
		expect(d.get("a")?.rank).toBe(1);
	});

	it("gives an isolated person a zero entry rather than no entry", () => {
		const d = degrees([personNode("lonely")], []);
		expect(d.get("lonely")).toEqual({ family: 0, social: 0, rank: 0 });
	});
});
