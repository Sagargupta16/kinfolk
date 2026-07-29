import { describe, expect, it } from "vitest";
import type { FlowEdge } from "./graph";
import { neighbourhood } from "./neighbourhood";

const isUnion = (id: string) => id.startsWith("union:");

function family(id: string, source: string, target: string): FlowEdge {
	return { id, source, target, kind: "child", layout: true };
}

function relation(id: string, source: string, target: string): FlowEdge {
	return { id, source, target, kind: "relation", layout: false, relationKind: "friend" };
}

/*
 *   mum --\             pop --\
 *          union:1 -- kid      union:2 -- niece
 *   dad --/
 */
const edges: FlowEdge[] = [
	family("e1", "mum", "union:1"),
	family("e2", "dad", "union:1"),
	family("e3", "union:1", "kid"),
	family("e4", "pop", "union:2"),
	family("e5", "union:2", "niece"),
	relation("r1", "kid", "friend"),
];

describe("neighbourhood", () => {
	it("reaches the partner on the far side of the union dot", () => {
		const { nodeIds } = neighbourhood(edges, "mum", isUnion);
		expect(nodeIds.has("dad")).toBe(true);
	});

	it("reaches the children hanging below the union dot", () => {
		const { nodeIds } = neighbourhood(edges, "mum", isUnion);
		expect(nodeIds.has("kid")).toBe(true);
	});

	it("stops at one hop past the union, not the whole tree", () => {
		const { nodeIds } = neighbourhood(edges, "mum", isUnion);
		// A separate family, connected to nothing mum touches.
		expect(nodeIds.has("pop")).toBe(false);
		expect(nodeIds.has("niece")).toBe(false);
		// Reached only via kid, who is already the last hop.
		expect(nodeIds.has("friend")).toBe(false);
	});

	it("includes the union dots themselves so the join stays lit", () => {
		const { nodeIds } = neighbourhood(edges, "mum", isUnion);
		expect(nodeIds.has("union:1")).toBe(true);
	});

	it("keeps every edge along the lit path", () => {
		const { edgeIds } = neighbourhood(edges, "mum", isUnion);
		expect([...edgeIds].sort()).toEqual(["e1", "e2", "e3"]);
	});

	it("includes relation edges without expanding through them", () => {
		const { nodeIds, edgeIds } = neighbourhood(edges, "kid", isUnion);
		expect(edgeIds.has("r1")).toBe(true);
		expect(nodeIds.has("friend")).toBe(true);
	});

	it("returns just the person when they are connected to nobody", () => {
		const { nodeIds, edgeIds } = neighbourhood(edges, "stranger", isUnion);
		expect([...nodeIds]).toEqual(["stranger"]);
		expect(edgeIds.size).toBe(0);
	});
});
