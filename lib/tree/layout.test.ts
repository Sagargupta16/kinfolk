/**
 * Layout tests exist for exactly one property: social edges must not move
 * anybody. Everything else about ELK's output is its business, not ours.
 */
import { describe, expect, it } from "vitest";
import type { FlowEdge, FlowNode, FusedPerson } from "./graph";
import { layoutGraph, type PositionedNode } from "./layout";

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
		expect(await layoutGraph([], [])).toEqual({ nodes: [], bands: [] });
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
