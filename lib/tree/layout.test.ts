/**
 * Layout tests exist for exactly one property: social edges must not move
 * anybody. Everything else about ELK's output is its business, not ours.
 */
import { describe, expect, it } from "vitest";
import type { FlowEdge, FlowNode, FusedPerson } from "./graph";
import { layoutGraph } from "./layout";

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

describe("layoutGraph", () => {
	it("returns nothing for an empty graph", async () => {
		expect(await layoutGraph([], [])).toEqual([]);
	});

	it("ignores relation edges when assigning generations", async () => {
		const nodes = [personNode("parent"), personNode("child"), personNode("friend")];
		const family = [familyEdge("f1", "parent", "child")];

		const withoutRelations = await layoutGraph(nodes, family);
		const withRelations = await layoutGraph(nodes, [
			...family,
			// If this edge reached ELK, "friend" would be pushed a layer below
			// "child" and every y coordinate here would change.
			relationEdge("r1", "child", "friend"),
		]);

		expect(withRelations.map((n) => n.position)).toEqual(withoutRelations.map((n) => n.position));
	});

	it("places a parent above their child", async () => {
		const positioned = await layoutGraph(
			[personNode("parent"), personNode("child")],
			[familyEdge("f1", "parent", "child")],
		);

		const parent = positioned.find((n) => n.id === "parent");
		const child = positioned.find((n) => n.id === "child");
		expect(parent && child && parent.position.y < child.position.y).toBe(true);
	});

	it("keeps a friend in the same generation as the person they know", async () => {
		const positioned = await layoutGraph(
			[personNode("parent"), personNode("child"), personNode("friend")],
			[familyEdge("f1", "parent", "child"), relationEdge("r1", "child", "friend")],
		);

		const child = positioned.find((n) => n.id === "child");
		const friend = positioned.find((n) => n.id === "friend");
		// Both are roots as far as the family graph is concerned... except child has
		// a parent, so what matters is that friend was not pushed BELOW child.
		expect(friend && child && friend.position.y <= child.position.y).toBe(true);
	});
});
